import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignLeads, campaigns, calls, leads, prospectOutreachEvents } from "@/db/schema";
import { launchCampaignBatch } from "@/lib/campaign-runner";
import { validateElevenLabsSignature } from "@/lib/elevenlabs";
import { getRuntimeEnv } from "@/lib/env";
import { resolveElevenLabsCredentials } from "@/lib/integrations";

const activeStatuses = ["creating", "queued", "initiated", "ringing", "answered", "in-progress"];

export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: ElevenLabsPostCall;
  try { body = JSON.parse(rawBody) as ElevenLabsPostCall; } catch { return new Response("Invalid JSON.", { status: 400 }); }
  const conversationId = body.data?.conversation_id || body.conversation_id;
  if (!conversationId) return new Response(null, { status: 204 });
  const db = getDb();
  const runtime = getRuntimeEnv();
  const [record] = await db.select().from(calls).where(and(eq(calls.providerCallId, conversationId), eq(calls.aiProvider, "elevenlabs"))).limit(1);
  const credentials = record ? await resolveElevenLabsCredentials(db, runtime, record.organizationId).catch(() => null) : null;
  if (!credentials || !(await validateElevenLabsSignature(rawBody, request.headers.get("elevenlabs-signature"), credentials.webhookSecret))) {
    return new Response("Invalid ElevenLabs signature.", { status: 403 });
  }
  if (!record) return new Response(null, { status: 204 });
  const now = Date.now();
  const duration = finiteNumber(body.data?.metadata?.call_duration_secs ?? body.data?.metadata?.call_duration_seconds);
  const transcript = normalizeTranscript(body.data?.transcript, record.createdAt);
  const analysis = body.data?.analysis;
  const summary = safeText(analysis?.transcript_summary || analysis?.summary, 2_000) || record.summary || "ElevenLabs completed the conversation.";
  const outcome = record.outcome || inferOutcome(analysis, transcript);
  await db.update(calls).set({ status: "completed", startedAt: record.startedAt || (duration ? now - duration * 1000 : record.createdAt), aiDisclosureAt: record.aiDisclosureAt || (duration ? now - duration * 1000 : record.createdAt), optOutDetectedAt: record.optOutDetectedAt || (outcome === "opted_out" ? now : null), endedAt: now, durationSeconds: duration || record.durationSeconds, transcriptJson: transcript.length ? JSON.stringify(transcript.slice(-100)) : record.transcriptJson, summary, outcome, updatedAt: now }).where(eq(calls.id, record.id));
  await db.update(prospectOutreachEvents).set({ status: "completed", outcome, providerReference: conversationId, notes: summary.slice(0, 500), updatedAt: now }).where(eq(prospectOutreachEvents.callId, record.id));
  if (record.campaignId) {
    const [lead] = await db.select({ internalDnc: leads.internalDnc }).from(leads).where(eq(leads.id, record.leadId)).limit(1);
    await db.update(campaignLeads).set({ status: "completed" }).where(and(eq(campaignLeads.campaignId, record.campaignId), eq(campaignLeads.leadId, record.leadId)));
    await db.update(leads).set(outcome === "opted_out" ? { status: "blocked", crmStage: "do_not_contact", internalDnc: true, consentStatus: "revoked", blockReasonsJson: JSON.stringify(["internal_do_not_call"]), updatedAt: now } : { status: lead?.internalDnc ? "blocked" : "completed", crmStage: outcome === "appointment_booked" ? "appointment_set" : outcome === "qualified" ? "qualified" : undefined, updatedAt: now }).where(eq(leads.id, record.leadId));
    try { await launchCampaignBatch({ db, runtime, campaignId: record.campaignId, actor: "system:elevenlabs", organizationId: record.organizationId, request, limitOverride: 1 }); } catch { /* Keep signed post-call delivery successful. */ }
    const [[queued], [active]] = await Promise.all([
      db.select({ value: count() }).from(campaignLeads).where(and(eq(campaignLeads.campaignId, record.campaignId), eq(campaignLeads.status, "queued"))),
      db.select({ value: count() }).from(calls).where(and(eq(calls.campaignId, record.campaignId), inArray(calls.status, activeStatuses))),
    ]);
    if (!Number(queued?.value) && !Number(active?.value)) await db.update(campaigns).set({ status: "completed", updatedAt: Date.now() }).where(eq(campaigns.id, record.campaignId));
  }
  return new Response(null, { status: 204 });
}

function normalizeTranscript(turns: ElevenLabsTurn[] | undefined, startedAt: number) {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((turn) => {
    const text = safeText(turn.message || turn.text, 4_000);
    if (!text) return [];
    return [{ role: turn.role === "agent" || turn.role === "assistant" ? "assistant" : "user", text, at: startedAt + Math.max(0, finiteNumber(turn.time_in_call_secs) || 0) * 1000 }];
  });
}

function inferOutcome(analysis: ElevenLabsAnalysis | undefined, transcript: Array<{ role: string; text: string }>): string {
  const joined = transcript.map((turn) => turn.text).join(" ").toLowerCase();
  if (/do not call|don['’]t call|remove me/.test(joined)) return "opted_out";
  if (/not interested/.test(joined)) return "not_interested";
  if (analysis?.call_successful === true || analysis?.call_successful === "success") return "qualified";
  return "completed";
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type ElevenLabsTurn = { role?: string; message?: string; text?: string; time_in_call_secs?: number };
type ElevenLabsAnalysis = { transcript_summary?: string; summary?: string; call_successful?: boolean | string };
type ElevenLabsPostCall = { conversation_id?: string; data?: { conversation_id?: string; transcript?: ElevenLabsTurn[]; metadata?: { call_duration_secs?: number; call_duration_seconds?: number }; analysis?: ElevenLabsAnalysis } };
