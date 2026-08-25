import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { campaignLeads, campaigns, calls, leads, organizations, prospectOutreachEvents } from "@/db/schema";
import {
  evaluateLeadCompliance,
  isWithinCallingWindow,
  MAX_CONCURRENT_CALLS,
} from "./compliance";
import { normalizedBaseUrl, type RuntimeEnv } from "./env";
import { getCalendarStatus } from "./calendar";
import { createTwilioCall } from "./twilio";
import { writeAuditEvent } from "./audit";
import { resolveOpenAICredentials, resolveTwilioCredentials } from "./integrations";
import { planFor } from "./plans";
import { incrementUsage, usageValue } from "./usage";

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
  organizationId?: string;
}): Promise<{ launched: number; skippedOutsideWindow: number; blocked: number }> {
  const [campaign] = await input.db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new Error("Campaign not found.");
  if (input.organizationId && campaign.organizationId !== input.organizationId) throw new Error("Campaign not found.");
  if (!campaign.createdByUserId) throw new Error("The campaign has no calendar owner.");
  const [organization] = await input.db.select({ planKey: organizations.planKey }).from(organizations).where(eq(organizations.id, campaign.organizationId)).limit(1);
  const plan = planFor(organization?.planKey);
  const callsUsed = await usageValue(input.db, campaign.organizationId, "callsStarted");
  if (callsUsed >= plan.callsPerMonth) throw new Error(`${plan.name} has reached its ${plan.callsPerMonth.toLocaleString()} call monthly limit.`);
  const twilio = await resolveTwilioCredentials(input.db, input.runtime, campaign.organizationId);
  const openai = await resolveOpenAICredentials(input.db, input.runtime, campaign.organizationId);
  const resolvedRuntime = { ...input.runtime, TWILIO_ACCOUNT_SID: twilio.accountSid, TWILIO_AUTH_TOKEN: twilio.authToken, TWILIO_FROM_NUMBER: twilio.fromNumber, OPENAI_API_KEY: openai.apiKey, OPENAI_MODEL: openai.model };
  assertProductionReady(resolvedRuntime);
  const calendar = await getCalendarStatus(input.db, campaign.organizationId, campaign.createdByUserId);
  if (!calendar.connected) throw new Error("The campaign owner must connect Outlook or Google Calendar before calling.");

  const [active] = await input.db
    .select({ value: count() })
    .from(calls)
    .where(
      and(
        eq(calls.campaignId, campaign.id),
        inArray(calls.status, ACTIVE_CALL_STATUSES),
      ),
    );
  const concurrency = Math.min(MAX_CONCURRENT_CALLS, plan.concurrentCalls, Math.max(1, campaign.maxConcurrent));
  const openSlots = Math.max(0, concurrency - Number(active?.value ?? 0));
  const remainingCalls = Math.max(0, plan.callsPerMonth - callsUsed);
  const requested = Math.min(remainingCalls, input.limitOverride ? Math.min(openSlots, input.limitOverride) : openSlots);
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
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      leadId: lead.leadId,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    });
    const outreachId = crypto.randomUUID();
    await input.db.insert(prospectOutreachEvents).values({ id: outreachId, organizationId: campaign.organizationId, leadId: lead.leadId, campaignId: campaign.id, callId, channel: "phone", status: "attempted", actor: input.actor, occurredAt: now, createdAt: now, updatedAt: now });
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
      const twilioCall = await createTwilioCall(resolvedRuntime, {
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
      await input.db.update(prospectOutreachEvents).set({ status: "submitted", providerReference: twilioCall.sid, updatedAt: Date.now() }).where(eq(prospectOutreachEvents.id, outreachId));
      launched += 1;
      await incrementUsage(input.db, campaign.organizationId, "callsStarted");
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
      await input.db.update(prospectOutreachEvents).set({ status: "failed", outcome: "provider_error", notes: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), updatedAt: Date.now() }).where(eq(prospectOutreachEvents.id, outreachId));
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
      organizationId: campaign.organizationId,
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
