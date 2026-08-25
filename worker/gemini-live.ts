import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { getDb } from "@/db";
import * as schema from "@/db/schema";
import { calls } from "@/db/schema";
import { executeAppointmentAgentTool, getAgentCallContext, type AppointmentAgentTool } from "@/lib/appointment-agent-tools";
import { buildDisclosureGreeting, buildLiveAgentPrompt } from "@/lib/agent-stack";
import type { RuntimeEnv } from "@/lib/env";
import { resolveGeminiCredentials, resolveTelnyxCredentials } from "@/lib/integrations";
import { hangupTelnyxCall, swapPcm16Endianness, validateMediaToken } from "@/lib/telnyx";
import { incrementUsage } from "@/lib/usage";

type Db = ReturnType<typeof getDb>;
type WorkerSocket = WebSocket & { accept(): void };
type SocketPair = { 0: WorkerSocket; 1: WorkerSocket };
type TranscriptTurn = { role: "user" | "assistant"; text: string; at: number };

export async function handleTelnyxMediaUpgrade(request: Request, runtime: RuntimeEnv): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required.", { status: 426 });
  const url = new URL(request.url);
  const callId = url.searchParams.get("callId");
  if (!callId || !runtime.APP_ENCRYPTION_KEY || !(await validateMediaToken(runtime.APP_ENCRYPTION_KEY, callId, url.searchParams.get("token")))) return new Response("Invalid media token.", { status: 403 });
  const db = drizzle(runtime.DB, { schema }) as unknown as Db;
  let context: Awaited<ReturnType<typeof getAgentCallContext>>;
  try {
    context = await getAgentCallContext(db, callId);
    if (context.telephonyProvider !== "telnyx" || context.aiProvider !== "gemini") throw new Error("Call stack mismatch.");
  } catch {
    return new Response("Call is not authorized.", { status: 403 });
  }
  const [geminiCredentials, telnyxCredentials] = await Promise.all([
    resolveGeminiCredentials(db, runtime, context.organizationId),
    resolveTelnyxCredentials(db, runtime, context.organizationId),
  ]);
  const Pair = (globalThis as unknown as { WebSocketPair: new () => SocketPair }).WebSocketPair;
  const pair = new Pair();
  const client = pair[0];
  const telnyxSocket = pair[1];
  telnyxSocket.accept();
  const geminiSocket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(geminiCredentials.apiKey)}`);
  const transcript = parseTranscript(context.transcriptJson);
  const queuedAudio: string[] = [];
  let streamId: string | undefined;
  let setupComplete = false;
  let pending = Promise.resolve();

  telnyxSocket.addEventListener("message", (event) => {
    const message = parseJson(event.data) as TelnyxMediaMessage | null;
    if (!message) return;
    if (message.event === "start") streamId = message.stream_id || message.start?.stream_id;
    if (message.event === "media" && message.media?.payload) {
      const audio = swapPcm16Endianness(message.media.payload);
      if (setupComplete && geminiSocket.readyState === WebSocket.OPEN) sendGeminiAudio(geminiSocket, audio);
      else if (queuedAudio.length < 100) queuedAudio.push(audio);
    }
    if (message.event === "stop" && geminiSocket.readyState < WebSocket.CLOSING) geminiSocket.close(1000, "Telnyx stream ended");
  });

  telnyxSocket.addEventListener("close", () => {
    if (geminiSocket.readyState < WebSocket.CLOSING) geminiSocket.close(1000, "Telnyx disconnected");
  });

  geminiSocket.addEventListener("open", () => {
    geminiSocket.send(JSON.stringify(buildGeminiSetup(geminiCredentials.model, geminiCredentials.voice, buildLiveAgentPrompt(toAgentContext(context)), buildDisclosureGreeting(toAgentContext(context)))));
  });

  geminiSocket.addEventListener("message", (event) => {
    pending = pending.then(async () => {
      const message = parseJson(event.data) as GeminiServerMessage | null;
      if (!message) return;
      if (message.setupComplete) {
        setupComplete = true;
        for (const audio of queuedAudio.splice(0)) sendGeminiAudio(geminiSocket, audio);
        geminiSocket.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "Begin the outbound call now with the mandatory disclosure greeting. Do not wait for another instruction." }] }], turnComplete: true } }));
        const now = Date.now();
        await db.update(calls).set({ status: "in-progress", startedAt: now, aiDisclosureAt: now, updatedAt: now }).where(eq(calls.id, callId));
      }
      for (const part of message.serverContent?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
          telnyxSocket.send(JSON.stringify({ event: "media", stream_id: streamId, media: { payload: swapPcm16Endianness(part.inlineData.data) } }));
        }
      }
      const userText = message.serverContent?.inputTranscription?.text?.trim();
      const assistantText = message.serverContent?.outputTranscription?.text?.trim();
      if (userText) { transcript.push({ role: "user", text: userText, at: Date.now() }); await incrementUsage(db, context.organizationId, "aiTurns"); }
      if (assistantText) transcript.push({ role: "assistant", text: assistantText, at: Date.now() });
      if (userText || assistantText) await db.update(calls).set({ transcriptJson: JSON.stringify(transcript.slice(-100)), updatedAt: Date.now() }).where(eq(calls.id, callId));
      if (message.toolCall?.functionCalls?.length) {
        const functionResponses = [];
        let shouldHangup = false;
        for (const functionCall of message.toolCall.functionCalls) {
          const name = functionCall.name as AppointmentAgentTool;
          try {
            const result = await executeAppointmentAgentTool({ db, runtime, callId, tool: name, arguments: functionCall.args ?? {} });
            functionResponses.push({ id: functionCall.id, name, response: { result } });
            if (name === "opt_out" || name === "end_call") shouldHangup = true;
          } catch (error) {
            functionResponses.push({ id: functionCall.id, name, response: { error: error instanceof Error ? error.message.slice(0, 400) : "Tool action failed." } });
          }
        }
        geminiSocket.send(JSON.stringify({ toolResponse: { functionResponses } }));
        if (shouldHangup) setTimeout(() => void hangupCurrentTelnyxCall(db, telnyxCredentials, callId), 6_000);
      }
    }).catch(async (error) => {
      await db.update(calls).set({ outcome: "system_error", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Gemini Live processing failed.", updatedAt: Date.now() }).where(eq(calls.id, callId));
    });
  });

  geminiSocket.addEventListener("error", () => {
    void db.update(calls).set({ outcome: "system_error", errorMessage: "Gemini Live WebSocket failed.", updatedAt: Date.now() }).where(eq(calls.id, callId));
  });

  return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
}

function buildGeminiSetup(model: string, voice: string, prompt: string, greeting: string) {
  return { setup: {
    model: `models/${model.replace(/^models\//, "")}`,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    systemInstruction: { parts: [{ text: `${prompt}\n\nYour exact opening line is: ${greeting}` }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [{ functionDeclarations: [
      { name: "list_slots", description: "Return verified calendar slots and signed slot tokens.", parameters: { type: "OBJECT", properties: {} } },
      { name: "book_appointment", description: "Book an explicitly confirmed verified slot.", parameters: { type: "OBJECT", required: ["startAt", "endAt", "timezone", "slotToken", "email", "confirmationText"], properties: { startAt: { type: "STRING" }, endAt: { type: "STRING" }, timezone: { type: "STRING" }, slotToken: { type: "STRING" }, email: { type: "STRING" }, confirmationText: { type: "STRING", description: "The prospect's verbatim explicit confirmation." } } } },
      { name: "opt_out", description: "Immediately suppress a prospect who asks not to be called.", parameters: { type: "OBJECT", properties: { source: { type: "STRING" } } } },
      { name: "end_call", description: "Record the final outcome before ending a conversation.", parameters: { type: "OBJECT", required: ["outcome", "summary"], properties: { outcome: { type: "STRING" }, summary: { type: "STRING" } } } },
    ] }],
  } };
}

function sendGeminiAudio(socket: WebSocket, data: string) {
  socket.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } }));
}

async function hangupCurrentTelnyxCall(db: Db, credentials: Awaited<ReturnType<typeof resolveTelnyxCredentials>>, callId: string) {
  const [record] = await db.select({ providerCallId: calls.providerCallId }).from(calls).where(eq(calls.id, callId)).limit(1);
  if (record?.providerCallId) await hangupTelnyxCall(credentials, record.providerCallId).catch(() => undefined);
}

function toAgentContext(context: Awaited<ReturnType<typeof getAgentCallContext>>) {
  return { callId: context.callId, lead: { firstName: context.firstName, lastName: context.lastName, company: context.company, title: context.title, email: context.email, timezone: context.timezone }, campaign: { sellerName: context.sellerName, productName: context.productName, agentName: context.agentName, productSummary: context.productSummary, objective: context.objective, meetingDurationMinutes: context.meetingDurationMinutes } };
}

function parseTranscript(value: string): TranscriptTurn[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseJson(value: unknown): unknown { try { return JSON.parse(typeof value === "string" ? value : new TextDecoder().decode(value as ArrayBuffer)); } catch { return null; } }

type TelnyxMediaMessage = { event?: string; stream_id?: string; start?: { stream_id?: string }; media?: { payload?: string } };
type GeminiServerMessage = { setupComplete?: object; serverContent?: { modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }; inputTranscription?: { text?: string }; outputTranscription?: { text?: string } }; toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> } };
