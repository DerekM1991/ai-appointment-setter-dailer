import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { campaignLeads, campaigns, calls, leads } from "@/db/schema";
import {
  evaluateLeadCompliance,
  isWithinCallingWindow,
  MAX_CONCURRENT_CALLS,
} from "./compliance";
import { normalizedBaseUrl, type RuntimeEnv } from "./env";
import { getOutlookStatus } from "./outlook";
import { createTwilioCall } from "./twilio";
import { writeAuditEvent } from "./audit";

type Db = ReturnType<typeof getDb>;

const ACTIVE_CALL_STATUSES = [
  "queued",
  "initiated",
  "ringing",
  "answered",
  "in-progress",
];

export async function launchCampaignBatch(input: {
  db: Db;
  runtime: RuntimeEnv;
  campaignId: string;
  actor: string;
  request?: Request;
  limitOverride?: number;
}): Promise<{ launched: number; skippedOutsideWindow: number; blocked: number }> {
  const [campaign] = await input.db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  assertProductionReady(input.runtime);
  const outlook = await getOutlookStatus(input.db);
  if (!outlook.connected) throw new Error("Outlook must be connected before calling.");

  const [active] = await input.db
    .select({ value: count() })
    .from(calls)
    .where(
      and(
        eq(calls.campaignId, campaign.id),
        inArray(calls.status, ACTIVE_CALL_STATUSES),
      ),
    );
  const concurrency = Math.min(MAX_CONCURRENT_CALLS, Math.max(1, campaign.maxConcurrent));
  const openSlots = Math.max(0, concurrency - Number(active?.value ?? 0));
  const requested = input.limitOverride
    ? Math.min(openSlots, input.limitOverride)
    : openSlots;
  if (!requested) return { launched: 0, skippedOutsideWindow: 0, blocked: 0 };

  const queued = await input.db
    .select({
      campaignLeadStatus: campaignLeads.status,
      leadId: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      phoneE164: leads.phoneE164,
      timezone: leads.timezone,
      consentStatus: leads.consentStatus,
      consentCapturedAt: leads.consentCapturedAt,
      consentSource: leads.consentSource,
      consentEvidence: leads.consentEvidence,
      dncCheckedAt: leads.dncCheckedAt,
      internalDnc: leads.internalDnc,
    })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .where(
      and(
        eq(campaignLeads.campaignId, campaign.id),
        eq(campaignLeads.status, "queued"),
      ),
    )
    .orderBy(asc(campaignLeads.priority), asc(campaignLeads.createdAt))
    .limit(Math.max(requested * 4, requested));

  const baseUrl = normalizedBaseUrl(input.runtime, input.request);
  let launched = 0;
  let blocked = 0;
  let skippedOutsideWindow = 0;
  for (const lead of queued) {
    if (launched >= requested) break;
    const compliance = evaluateLeadCompliance({
      phoneE164: lead.phoneE164,
      timezone: lead.timezone,
      consentStatus: lead.consentStatus,
      consentCapturedAt: lead.consentCapturedAt,
      consentSource: lead.consentSource,
      consentEvidence: lead.consentEvidence,
      dncCheckedAt: lead.dncCheckedAt,
      internalDnc: lead.internalDnc,
    });
    if (!compliance.eligible) {
      blocked += 1;
      await input.db
        .update(leads)
        .set({
          status: "blocked",
          blockReasonsJson: JSON.stringify(compliance.reasons),
          updatedAt: Date.now(),
        })
        .where(eq(leads.id, lead.leadId));
      await input.db
        .update(campaignLeads)
        .set({ status: "blocked" })
        .where(
          and(
            eq(campaignLeads.campaignId, campaign.id),
            eq(campaignLeads.leadId, lead.leadId),
          ),
        );
      continue;
    }
    if (!lead.timezone || !isWithinCallingWindow(lead.timezone)) {
      skippedOutsideWindow += 1;
      continue;
    }

    const callId = crypto.randomUUID();
    const now = Date.now();
    await input.db.insert(calls).values({
      id: callId,
      campaignId: campaign.id,
      leadId: lead.leadId,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    });
    await input.db
      .update(campaignLeads)
      .set({ status: "calling" })
      .where(
        and(
          eq(campaignLeads.campaignId, campaign.id),
          eq(campaignLeads.leadId, lead.leadId),
        ),
      );
    await input.db
      .update(leads)
      .set({ status: "calling", updatedAt: now })
      .where(eq(leads.id, lead.leadId));

    try {
      const voiceUrl = `${baseUrl}/api/twilio/voice?callId=${encodeURIComponent(callId)}`;
      const statusCallbackUrl = `${baseUrl}/api/twilio/status?callId=${encodeURIComponent(callId)}`;
      const twilioCall = await createTwilioCall(input.runtime, {
        to: lead.phoneE164,
        voiceUrl,
        statusCallbackUrl,
      });
      await input.db
        .update(calls)
        .set({
          twilioCallSid: twilioCall.sid,
          status: twilioCall.status,
          updatedAt: Date.now(),
        })
        .where(eq(calls.id, callId));
      launched += 1;
    } catch (error) {
      await input.db
        .update(calls)
        .set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          endedAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(eq(calls.id, callId));
      await input.db
        .update(campaignLeads)
        .set({ status: "completed" })
        .where(
          and(
            eq(campaignLeads.campaignId, campaign.id),
            eq(campaignLeads.leadId, lead.leadId),
          ),
        );
      await input.db
        .update(leads)
        .set({ status: "eligible", updatedAt: Date.now() })
        .where(eq(leads.id, lead.leadId));
    }
  }

  if (launched > 0) {
    await input.db
      .update(campaigns)
      .set({ status: "running", updatedAt: Date.now() })
      .where(eq(campaigns.id, campaign.id));
    await writeAuditEvent(input.db, {
      actor: input.actor,
      eventType: "campaign_batch_launched",
      entityType: "campaign",
      entityId: campaign.id,
      details: { launched, blocked, skippedOutsideWindow, concurrency },
    });
  }
  return { launched, blocked, skippedOutsideWindow };
}

function assertProductionReady(runtime: RuntimeEnv) {
  const missing = [
    ["TWILIO_ACCOUNT_SID", runtime.TWILIO_ACCOUNT_SID],
    ["TWILIO_AUTH_TOKEN", runtime.TWILIO_AUTH_TOKEN],
    ["TWILIO_FROM_NUMBER", runtime.TWILIO_FROM_NUMBER],
    ["OPENAI_API_KEY", runtime.OPENAI_API_KEY],
    ["APP_ENCRYPTION_KEY", runtime.APP_ENCRYPTION_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(", ")}.`);
}
