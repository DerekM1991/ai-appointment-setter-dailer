import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { campaignLeads, campaigns, calls, leads } from "@/db/schema";
import { launchCampaignBatch } from "@/lib/campaign-runner";
import { getRuntimeEnv } from "@/lib/env";
import { validateTwilioRequest } from "@/lib/twilio";
import { resolveTwilioCredentials } from "@/lib/integrations";

const terminal = new Set(["completed", "busy", "no-answer", "canceled", "failed"]);
const activeStatuses = ["queued", "initiated", "ringing", "answered", "in-progress"];

export async function POST(request: Request) {
  const runtime = getRuntimeEnv();
  const callId = new URL(request.url).searchParams.get("callId");
  if (!callId) return new Response(null, { status: 204 });
  const db = getDb();
  const [record] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  const form = new URLSearchParams(await request.text());
  const credentials = record ? await resolveTwilioCredentials(db, runtime, record.organizationId).catch(() => null) : null;
  if (!credentials || !(await validateTwilioRequest(request, credentials.authToken, form))) return new Response("Invalid Twilio signature.", { status: 403 });
  if (!record || (record.twilioCallSid && record.twilioCallSid !== form.get("CallSid"))) {
    return new Response(null, { status: 204 });
  }
  const status = form.get("CallStatus") || record.status;
  const now = Date.now();
  const duration = Number(form.get("CallDuration"));
  await db
    .update(calls)
    .set({
      status,
      startedAt:
        record.startedAt || (status === "in-progress" ? now : record.startedAt),
      endedAt: terminal.has(status) ? now : record.endedAt,
      durationSeconds: Number.isFinite(duration) ? duration : record.durationSeconds,
      errorCode: form.get("ErrorCode") || record.errorCode,
      errorMessage: form.get("ErrorMessage") || record.errorMessage,
      outcome:
        record.outcome ||
        (status === "busy" || status === "no-answer" ? status.replace("-", "_") : null),
      updatedAt: now,
    })
    .where(eq(calls.id, callId));

  if (terminal.has(status) && record.campaignId) {
    const [lead] = await db
      .select({ internalDnc: leads.internalDnc })
      .from(leads)
      .where(eq(leads.id, record.leadId))
      .limit(1);
    await db
      .update(campaignLeads)
      .set({ status: "completed" })
      .where(
        and(
          eq(campaignLeads.campaignId, record.campaignId),
          eq(campaignLeads.leadId, record.leadId),
        ),
      );
    await db
      .update(leads)
      .set({
        status: lead?.internalDnc ? "blocked" : "completed",
        updatedAt: now,
      })
      .where(eq(leads.id, record.leadId));
    try {
      await launchCampaignBatch({
        db,
        runtime,
        campaignId: record.campaignId,
        actor: "system:twilio",
        organizationId: record.organizationId,
        request,
        limitOverride: 1,
      });
    } catch {
      // The status callback must remain successful; configuration errors surface in the dashboard.
    }
    const [[queued], [active]] = await Promise.all([
      db
        .select({ value: count() })
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.campaignId, record.campaignId),
            eq(campaignLeads.status, "queued"),
          ),
        ),
      db
        .select({ value: count() })
        .from(calls)
        .where(
          and(
            eq(calls.campaignId, record.campaignId),
            inArray(calls.status, activeStatuses),
          ),
        ),
    ]);
    if (!Number(queued?.value) && !Number(active?.value)) {
      await db
        .update(campaigns)
        .set({ status: "completed", updatedAt: Date.now() })
        .where(eq(campaigns.id, record.campaignId));
    }
  }
  return new Response(null, { status: 204 });
}
