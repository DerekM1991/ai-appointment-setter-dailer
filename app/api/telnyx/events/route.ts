import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignLeads, campaigns, calls, leads, prospectOutreachEvents } from "@/db/schema";
import { launchCampaignBatch } from "@/lib/campaign-runner";
import { getRuntimeEnv } from "@/lib/env";
import { resolveTelnyxCredentials } from "@/lib/integrations";
import { validateTelnyxRequest } from "@/lib/telnyx";

const activeStatuses = ["creating", "queued", "initiated", "ringing", "answered", "in-progress"];

export async function POST(request: Request) {
  const rawBody = await request.text();
  const callId = new URL(request.url).searchParams.get("callId");
  if (!callId) return new Response(null, { status: 204 });
  const db = getDb();
  const runtime = getRuntimeEnv();
  const [record] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  const credentials = record ? await resolveTelnyxCredentials(db, runtime, record.organizationId).catch(() => null) : null;
  const valid = credentials && await validateTelnyxRequest(rawBody, request.headers.get("telnyx-signature-ed25519"), request.headers.get("telnyx-timestamp"), credentials.publicKey);
  if (!valid) return new Response("Invalid Telnyx signature.", { status: 403 });
  let payload: TelnyxEvent;
  try { payload = JSON.parse(rawBody) as TelnyxEvent; } catch { return new Response("Invalid JSON.", { status: 400 }); }
  if (!record) return new Response(null, { status: 204 });
  const event = payload.data?.event_type || "";
  const eventCallId = payload.data?.payload?.call_control_id || payload.data?.payload?.call_session_id || null;
  if (record.providerCallId && eventCallId && record.providerCallId !== eventCallId) return new Response(null, { status: 204 });
  const now = Date.now();
  const terminal = event === "call.hangup";
  const status = mapStatus(event, payload.data?.payload?.hangup_cause);
  await db.update(calls).set({
    status: status || record.status,
    startedAt: record.startedAt || (event === "call.answered" ? now : null),
    aiDisclosureAt: record.aiDisclosureAt || (event === "call.answered" ? now : null),
    endedAt: terminal ? now : record.endedAt,
    durationSeconds: terminal && record.startedAt ? Math.max(0, Math.round((now - record.startedAt) / 1000)) : record.durationSeconds,
    outcome: record.outcome || terminalOutcome(payload.data?.payload?.hangup_cause),
    errorMessage: payload.data?.payload?.hangup_source === "telnyx" && payload.data?.payload?.hangup_cause ? payload.data.payload.hangup_cause.slice(0, 500) : record.errorMessage,
    updatedAt: now,
  }).where(eq(calls.id, callId));
  await db.update(prospectOutreachEvents).set({ status: status || event, outcome: record.outcome || (terminal ? terminalOutcome(payload.data?.payload?.hangup_cause) : null), providerReference: eventCallId || record.providerCallId, updatedAt: now }).where(eq(prospectOutreachEvents.callId, callId));
  if (terminal && record.campaignId) await finishQueueSlot({ db, runtime, request, record, now });
  return new Response(null, { status: 204 });
}

async function finishQueueSlot(input: { db: ReturnType<typeof getDb>; runtime: ReturnType<typeof getRuntimeEnv>; request: Request; record: typeof calls.$inferSelect; now: number }) {
  const [lead] = await input.db.select({ internalDnc: leads.internalDnc }).from(leads).where(eq(leads.id, input.record.leadId)).limit(1);
  await input.db.update(campaignLeads).set({ status: "completed" }).where(and(eq(campaignLeads.campaignId, input.record.campaignId!), eq(campaignLeads.leadId, input.record.leadId)));
  await input.db.update(leads).set({ status: lead?.internalDnc ? "blocked" : "completed", updatedAt: input.now }).where(eq(leads.id, input.record.leadId));
  try { await launchCampaignBatch({ db: input.db, runtime: input.runtime, campaignId: input.record.campaignId!, actor: "system:telnyx", organizationId: input.record.organizationId, request: input.request, limitOverride: 1 }); } catch { /* Keep provider callbacks successful. */ }
  const [[queued], [active]] = await Promise.all([
    input.db.select({ value: count() }).from(campaignLeads).where(and(eq(campaignLeads.campaignId, input.record.campaignId!), eq(campaignLeads.status, "queued"))),
    input.db.select({ value: count() }).from(calls).where(and(eq(calls.campaignId, input.record.campaignId!), inArray(calls.status, activeStatuses))),
  ]);
  if (!Number(queued?.value) && !Number(active?.value)) await input.db.update(campaigns).set({ status: "completed", updatedAt: Date.now() }).where(eq(campaigns.id, input.record.campaignId!));
}

function mapStatus(event: string, cause?: string): string | null {
  if (event === "call.initiated") return "initiated";
  if (event === "call.answered") return "in-progress";
  if (event === "call.bridged") return "in-progress";
  if (event === "call.hangup") return cause && cause !== "normal_clearing" ? "failed" : "completed";
  return null;
}

function terminalOutcome(cause?: string): string | null {
  if (!cause || cause === "normal_clearing") return null;
  if (/busy/i.test(cause)) return "busy";
  if (/no_answer|timeout/i.test(cause)) return "no_answer";
  return "provider_error";
}

type TelnyxEvent = { data?: { event_type?: string; payload?: { call_control_id?: string; call_session_id?: string; hangup_cause?: string; hangup_source?: string } } };
