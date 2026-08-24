import { count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointments,
  auditEvents,
  campaignLeads,
  campaigns,
  calls,
  leads,
} from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv, integrationReadiness } from "@/lib/env";
import { getOutlookStatus } from "@/lib/outlook";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const db = getDb();
    const runtime = getRuntimeEnv();
    const [
      [eligible],
      [blocked],
      [active],
      [booked],
      leadRows,
      campaignRows,
      queueRows,
      callRows,
      appointmentRows,
      auditRows,
      outlook,
    ] = await Promise.all([
      db.select({ value: count() }).from(leads).where(eq(leads.status, "eligible")),
      db.select({ value: count() }).from(leads).where(eq(leads.status, "blocked")),
      db
        .select({ value: count() })
        .from(calls)
        .where(
          inArray(calls.status, [
            "queued",
            "initiated",
            "ringing",
            "answered",
            "in-progress",
          ]),
        ),
      db
        .select({ value: count() })
        .from(appointments)
        .where(eq(appointments.status, "confirmed")),
      db.select().from(leads).orderBy(desc(leads.createdAt)).limit(100),
      db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(25),
      db
        .select({
          campaignId: campaignLeads.campaignId,
          status: campaignLeads.status,
          value: count(),
        })
        .from(campaignLeads)
        .groupBy(campaignLeads.campaignId, campaignLeads.status),
      db
        .select({
          id: calls.id,
          twilioCallSid: calls.twilioCallSid,
          status: calls.status,
          outcome: calls.outcome,
          startedAt: calls.startedAt,
          endedAt: calls.endedAt,
          durationSeconds: calls.durationSeconds,
          summary: calls.summary,
          firstName: leads.firstName,
          lastName: leads.lastName,
          company: leads.company,
        })
        .from(calls)
        .innerJoin(leads, eq(calls.leadId, leads.id))
        .orderBy(desc(calls.createdAt))
        .limit(50),
      db
        .select({
          id: appointments.id,
          subject: appointments.subject,
          startAt: appointments.startAt,
          endAt: appointments.endAt,
          timezone: appointments.timezone,
          attendeeEmail: appointments.attendeeEmail,
          joinUrl: appointments.joinUrl,
          status: appointments.status,
          firstName: leads.firstName,
          lastName: leads.lastName,
          company: leads.company,
        })
        .from(appointments)
        .innerJoin(leads, eq(appointments.leadId, leads.id))
        .orderBy(desc(appointments.startAt))
        .limit(50),
      db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(30),
      getOutlookStatus(db),
    ]);
    const queueByCampaign = new Map<string, Record<string, number>>();
    for (const row of queueRows) {
      const current = queueByCampaign.get(row.campaignId) ?? {};
      current[row.status] = Number(row.value);
      queueByCampaign.set(row.campaignId, current);
    }
    const config = integrationReadiness(runtime);
    const readiness = {
      twilio: config.twilio,
      openai: config.openai,
      outlook: outlook.connected,
      eligibleProspects: Number(eligible?.value ?? 0) > 0,
      baseUrl: config.baseUrl,
    };
    return Response.json({
      viewer: { displayName: auth.displayName, email: auth.email },
      metrics: {
        eligible: Number(eligible?.value ?? 0),
        blocked: Number(blocked?.value ?? 0),
        active: Number(active?.value ?? 0),
        booked: Number(booked?.value ?? 0),
      },
      leads: leadRows.map((lead) => ({
        ...lead,
        blockReasons: safeJsonArray(lead.blockReasonsJson),
        phoneE164: maskPhone(lead.phoneE164),
      })),
      campaigns: campaignRows.map((campaign) => ({
        ...campaign,
        queue: queueByCampaign.get(campaign.id) ?? {},
      })),
      calls: callRows,
      appointments: appointmentRows,
      auditEvents: auditRows.map((event) => ({
        ...event,
        details: safeJsonObject(event.detailsJson),
      })),
      integrations: {
        outlook,
        twilio: { configured: config.twilio },
        openai: {
          configured: config.openai,
          model: runtime.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
        },
        appBaseUrl: { configured: config.baseUrl },
      },
      readiness,
      readinessPassed: Object.values(readiness).filter(Boolean).length,
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function maskPhone(value: string): string {
  return `${value.slice(0, Math.max(2, value.length - 4)).replace(/\d/g, "•")}${value.slice(-4)}`;
}
