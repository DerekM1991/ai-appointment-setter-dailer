import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { getDb } from "@/db";
import * as schema from "@/db/schema";
import {
  appointments,
  campaignLeads,
  campaigns,
  calls,
  leads,
} from "@/db/schema";
import { writeAuditEvent } from "@/lib/audit";
import {
  detectsOptOut,
  isExplicitBookingConfirmation,
  isValidEmail,
} from "@/lib/compliance";
import type { RuntimeEnv } from "@/lib/env";
import {
  decideAgentTurn,
  type TranscriptTurn,
} from "@/lib/openai-agent";
import {
  createOutlookAppointment,
  getAvailableSlots,
  type AvailableSlot,
} from "@/lib/outlook";
import { validateTwilioRequest } from "@/lib/twilio";

type Db = ReturnType<typeof getDb>;
type WorkerSocket = WebSocket & { accept(): void };
type SocketPair = { 0: WorkerSocket; 1: WorkerSocket };

type Session = {
  db: Db;
  runtime: RuntimeEnv;
  socket: WorkerSocket;
  callId: string;
  campaignId: string;
  leadId: string;
  transcript: TranscriptTurn[];
  slots: AvailableSlot[];
  lead: {
    firstName: string;
    lastName: string;
    company: string | null;
    title: string | null;
    email: string | null;
    timezone: string;
  };
  campaign: {
    sellerName: string;
    productName: string;
    agentName: string;
    productSummary: string;
    objective: string;
    meetingDurationMinutes: number;
  };
};

type RelayMessage = {
  type?: string;
  callSid?: string;
  voicePrompt?: string;
  last?: boolean;
  description?: string;
  customParameters?: Record<string, string>;
};

export async function handleConversationUpgrade(
  request: Request,
  runtime: RuntimeEnv,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required.", { status: 426 });
  }
  if (!(await validateTwilioRequest(request, runtime.TWILIO_AUTH_TOKEN))) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }
  const Pair = (globalThis as unknown as { WebSocketPair: new () => SocketPair })
    .WebSocketPair;
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  const db = drizzle(runtime.DB, { schema }) as unknown as Db;
  let session: Session | null = null;
  let messageQueue = Promise.resolve();

  server.addEventListener("message", (event) => {
    messageQueue = messageQueue
      .then(async () => {
        const message = parseRelayMessage(event.data);
        if (!message) return;
        if (message.type === "setup") {
          session = await initializeSession(db, runtime, server, message);
          return;
        }
        if (!session) {
          sendEnd(server, "invalid_session");
          return;
        }
        if (message.type === "prompt" && message.last === true && message.voicePrompt) {
          await handleProspectTurn(session, message.voicePrompt.trim());
        } else if (message.type === "error") {
          await session.db
            .update(calls)
            .set({
              errorMessage: message.description?.slice(0, 500) || "Conversation Relay error",
              updatedAt: Date.now(),
            })
            .where(eq(calls.id, session.callId));
        }
      })
      .catch(async (error) => {
        if (session) {
          const reply = "I'm sorry, I can't complete this call right now. Thank you for your time.";
          await appendAssistant(session, reply);
          await session.db
            .update(calls)
            .set({
              errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
              outcome: "system_error",
              summary: "The call ended because the conversation service encountered an error.",
              updatedAt: Date.now(),
            })
            .where(eq(calls.id, session.callId));
          speakAndEnd(session.socket, reply, "system_error");
        } else {
          sendEnd(server, "initialization_error");
        }
      });
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit & { webSocket: WebSocket });
}

async function initializeSession(
  db: Db,
  runtime: RuntimeEnv,
  socket: WorkerSocket,
  message: RelayMessage,
): Promise<Session | null> {
  const callId = message.customParameters?.callId;
  const leadId = message.customParameters?.leadId;
  const campaignId = message.customParameters?.campaignId;
  if (!callId || !leadId || !campaignId) {
    sendEnd(socket, "missing_parameters");
    return null;
  }
  const [record] = await db
    .select({
      callId: calls.id,
      twilioCallSid: calls.twilioCallSid,
      transcriptJson: calls.transcriptJson,
      leadId: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      company: leads.company,
      title: leads.title,
      email: leads.email,
      timezone: leads.timezone,
      internalDnc: leads.internalDnc,
      campaignId: campaigns.id,
      sellerName: campaigns.sellerName,
      productName: campaigns.productName,
      agentName: campaigns.agentName,
      productSummary: campaigns.productSummary,
      objective: campaigns.objective,
      meetingDurationMinutes: campaigns.meetingDurationMinutes,
    })
    .from(calls)
    .innerJoin(leads, eq(calls.leadId, leads.id))
    .innerJoin(campaigns, eq(calls.campaignId, campaigns.id))
    .where(eq(calls.id, callId))
    .limit(1);
  if (
    !record ||
    record.leadId !== leadId ||
    record.campaignId !== campaignId ||
    record.internalDnc ||
    !record.timezone ||
    (record.twilioCallSid && record.twilioCallSid !== message.callSid)
  ) {
    sendEnd(socket, "call_not_authorized");
    return null;
  }
  return {
    db,
    runtime,
    socket,
    callId,
    leadId,
    campaignId,
    transcript: parseTranscript(record.transcriptJson),
    slots: [],
    lead: {
      firstName: record.firstName,
      lastName: record.lastName,
      company: record.company,
      title: record.title,
      email: record.email,
      timezone: record.timezone,
    },
    campaign: {
      sellerName: record.sellerName,
      productName: record.productName,
      agentName: record.agentName,
      productSummary: record.productSummary,
      objective: record.objective,
      meetingDurationMinutes: record.meetingDurationMinutes,
    },
  };
}

async function handleProspectTurn(session: Session, utterance: string) {
  if (!utterance) return;
  session.transcript.push({ role: "user", text: utterance, at: Date.now() });
  await persistTranscript(session);
  if (detectsOptOut(utterance)) {
    await enforceOptOut(session, "prospect_phrase");
    return;
  }
  if (session.transcript.length > 50) {
    const reply = "I don't want to take more of your time. Thank you for speaking with me today.";
    await appendAssistant(session, reply);
    await finishCall(session, "conversation_limit", "The call reached the maximum conversation length.");
    speakAndEnd(session.socket, reply, "conversation_limit");
    return;
  }

  const decision = await decideAgentTurn({
    runtime: session.runtime,
    lead: session.lead,
    campaign: session.campaign,
    transcript: session.transcript,
    availableSlots: session.slots,
  });
  if (decision.action === "opt_out") {
    await enforceOptOut(session, "agent_intent_detection");
    return;
  }
  if (decision.action === "list_slots") {
    session.slots = await getAvailableSlots({
      db: session.db,
      runtime: session.runtime,
      timezone: session.lead.timezone,
      durationMinutes: session.campaign.meetingDurationMinutes,
      count: 3,
    });
    const reply = session.slots.length
      ? `I have ${humanSlotList(session.slots)}. Which one works best for you?`
      : `I don't see an open time in the next several business days. Someone from ${session.campaign.sellerName} can follow up to coordinate manually.`;
    await appendAssistant(session, reply);
    sendText(session.socket, reply);
    return;
  }
  if (decision.action === "book_appointment") {
    await attemptBooking(session, decision.selectedStartAt, decision.email, utterance);
    return;
  }

  await appendAssistant(session, decision.reply);
  if (decision.outcome !== "none") {
    await session.db
      .update(calls)
      .set({ outcome: decision.outcome, updatedAt: Date.now() })
      .where(eq(calls.id, session.callId));
  }
  sendText(session.socket, decision.reply);
  if (decision.action === "end") {
    await finishCall(
      session,
      decision.outcome === "none" ? "ended" : decision.outcome,
      decision.outcome === "not_interested"
        ? "The prospect declined the offer; no appointment was created."
        : "The conversation ended without an appointment.",
    );
    scheduleEnd(session.socket, decision.reply, decision.outcome || "ended");
  }
}

async function attemptBooking(
  session: Session,
  selectedStartAt: string,
  suppliedEmail: string,
  latestUtterance: string,
) {
  const slot = session.slots.find((candidate) => candidate.startAt === selectedStartAt);
  const email = (suppliedEmail || session.lead.email || "").trim().toLowerCase();
  if (!slot || !isExplicitBookingConfirmation(latestUtterance)) {
    const reply = "Before I book it, please confirm the exact time you want from the options I just offered.";
    await appendAssistant(session, reply);
    sendText(session.socket, reply);
    return;
  }
  if (!isValidEmail(email)) {
    const reply = "What email address should I use for the Outlook invitation?";
    await appendAssistant(session, reply);
    sendText(session.socket, reply);
    return;
  }
  const appointmentId = crypto.randomUUID();
  const subject = `${session.campaign.productName} discovery — ${session.lead.company || `${session.lead.firstName} ${session.lead.lastName}`}`;
  const now = Date.now();
  await session.db.insert(appointments).values({
    id: appointmentId,
    callId: session.callId,
    leadId: session.leadId,
    subject,
    startAt: Date.parse(slot.startAt),
    endAt: Date.parse(slot.endAt),
    timezone: slot.timezone,
    attendeeEmail: email,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  try {
    const event = await createOutlookAppointment({
      db: session.db,
      runtime: session.runtime,
      appointmentId,
      subject,
      startAt: slot.startAt,
      endAt: slot.endAt,
      attendeeEmail: email,
      attendeeName: `${session.lead.firstName} ${session.lead.lastName}`,
      notes:
        `Booked by ${session.campaign.agentName}, the disclosed AI appointment assistant for ${session.campaign.sellerName}, after the prospect explicitly confirmed the time and email address.`,
    });
    await session.db
      .update(appointments)
      .set({
        graphEventId: event.graphEventId,
        joinUrl: event.joinUrl,
        status: "confirmed",
        updatedAt: Date.now(),
      })
      .where(eq(appointments.id, appointmentId));
    await session.db
      .update(leads)
      .set({ email, updatedAt: Date.now() })
      .where(eq(leads.id, session.leadId));
    await session.db
      .update(calls)
      .set({
        appointmentId,
        outcome: "appointment_booked",
        summary: `The prospect booked ${slot.label}.`,
        updatedAt: Date.now(),
      })
      .where(eq(calls.id, session.callId));
    await writeAuditEvent(session.db, {
      actor: "system:agent",
      eventType: "appointment_booked",
      entityType: "appointment",
      entityId: appointmentId,
      details: { callId: session.callId, startAt: slot.startAt },
    });
    const reply = `You're all set for ${slot.label}. I sent the Outlook invitation to ${speakableEmail(email)}. Thanks for your time.`;
    await appendAssistant(session, reply);
    sendText(session.socket, reply);
    scheduleEnd(session.socket, reply, "appointment_booked");
  } catch (error) {
    await session.db
      .update(appointments)
      .set({ status: "failed", updatedAt: Date.now() })
      .where(eq(appointments.id, appointmentId));
    const reply = `I couldn't create the invitation just now, so I won't claim that it's booked. Someone from ${session.campaign.sellerName} can follow up to coordinate.`;
    await appendAssistant(session, reply);
    sendText(session.socket, reply);
    scheduleEnd(session.socket, reply, "calendar_error");
    await finishCall(
      session,
      "calendar_error",
      error instanceof Error ? error.message.slice(0, 500) : "Calendar booking failed.",
    );
  }
}

async function enforceOptOut(session: Session, source: string) {
  const now = Date.now();
  await session.db
    .update(leads)
    .set({
      internalDnc: true,
      consentStatus: "revoked",
      status: "blocked",
      blockReasonsJson: JSON.stringify(["internal_do_not_call"]),
      updatedAt: now,
    })
    .where(eq(leads.id, session.leadId));
  await session.db
    .update(campaignLeads)
    .set({ status: "completed" })
    .where(
      and(
        eq(campaignLeads.campaignId, session.campaignId),
        eq(campaignLeads.leadId, session.leadId),
      ),
    );
  await session.db
    .update(calls)
    .set({
      outcome: "opted_out",
      optOutDetectedAt: now,
      summary: "The prospect requested no further calls and was immediately added to the internal suppression list.",
      updatedAt: now,
    })
    .where(eq(calls.id, session.callId));
  await writeAuditEvent(session.db, {
    actor: "system:agent",
    eventType: "prospect_opted_out",
    entityType: "lead",
    entityId: session.leadId,
    details: { callId: session.callId, source },
  });
  const reply = "Understood. I've added you to our do-not-call list, and we won't call you again. Goodbye.";
  await appendAssistant(session, reply);
  sendText(session.socket, reply);
  scheduleEnd(session.socket, reply, "opted_out");
}

async function finishCall(session: Session, outcome: string, summary: string) {
  await session.db
    .update(calls)
    .set({ outcome, summary, updatedAt: Date.now() })
    .where(eq(calls.id, session.callId));
}

async function appendAssistant(session: Session, reply: string) {
  session.transcript.push({ role: "assistant", text: reply, at: Date.now() });
  await persistTranscript(session);
}

async function persistTranscript(session: Session) {
  await session.db
    .update(calls)
    .set({
      transcriptJson: JSON.stringify(session.transcript.slice(-80)),
      updatedAt: Date.now(),
    })
    .where(eq(calls.id, session.callId));
}

function sendText(socket: WorkerSocket, text: string) {
  socket.send(
    JSON.stringify({
      type: "text",
      token: text,
      last: true,
      interruptible: true,
      preemptible: true,
    }),
  );
}

function speakAndEnd(socket: WorkerSocket, text: string, reason: string) {
  sendText(socket, text);
  scheduleEnd(socket, text, reason);
}

function scheduleEnd(socket: WorkerSocket, text: string, reason: string) {
  const words = text.trim().split(/\s+/).length;
  const delay = Math.min(8_000, Math.max(1_500, Math.ceil((words / 2.5) * 1000 + 700)));
  setTimeout(() => sendEnd(socket, reason), delay);
}

function sendEnd(socket: WorkerSocket, reason: string) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: "end",
      handoffData: JSON.stringify({ reasonCode: reason }),
    }),
  );
}

function parseRelayMessage(value: unknown): RelayMessage | null {
  try {
    const text = typeof value === "string" ? value : new TextDecoder().decode(value as ArrayBuffer);
    return JSON.parse(text) as RelayMessage;
  } catch {
    return null;
  }
}

function parseTranscript(value: string): TranscriptTurn[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function humanSlotList(slots: AvailableSlot[]): string {
  if (slots.length === 1) return slots[0].label;
  return `${slots.slice(0, -1).map((slot) => slot.label).join(", ")}, or ${slots.at(-1)?.label}`;
}

function speakableEmail(value: string): string {
  return value.replace("@", " at ").replace(/\./g, " dot ");
}
