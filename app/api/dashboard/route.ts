import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { appointments, auditEvents, campaignLeads, campaigns, calls, leads, memberships, organizations, prospectOutreachEvents, usageCounters } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getCalendarStatus } from "@/lib/calendar";
import { getRuntimeEnv, integrationReadiness } from "@/lib/env";
import { listVisibleIntegrations } from "@/lib/integrations";
import { monthlyPeriodKey } from "@/lib/plans";
import { hasPermission, type Permission } from "@/lib/tenant";
import { resolveCallingLimits } from "@/lib/calling-limits";

export const dynamic = "force-dynamic";
const EXPOSED_PERMISSIONS: Permission[] = ["prospects:write", "campaigns:write", "calls:launch", "integrations:personal", "integrations:workspace", "members:manage", "billing:manage", "audit:read"];

export async function GET() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const db = getDb(); const runtime = getRuntimeEnv();
    const org = eq(leads.organizationId, auth.organizationId); const callOrg = eq(calls.organizationId, auth.organizationId); const campaignOrg = eq(campaigns.organizationId, auth.organizationId); const appointmentOrg = eq(appointments.organizationId, auth.organizationId); const auditOrg = eq(auditEvents.organizationId, auth.organizationId);
    const [eligibleRows, blockedRows, activeRows, bookedRows, leadRows, campaignRows, queueRows, callRows, appointmentRows, auditRows, calendar, connections, memberRows, usageRows, organizationRows, outreachRows] = await Promise.all([
      db.select({ value: count() }).from(leads).where(and(org, eq(leads.status, "eligible"))), db.select({ value: count() }).from(leads).where(and(org, eq(leads.status, "blocked"))), db.select({ value: count() }).from(calls).where(and(callOrg, inArray(calls.status, ["queued", "initiated", "ringing", "answered", "in-progress"]))), db.select({ value: count() }).from(appointments).where(and(appointmentOrg, eq(appointments.status, "confirmed"))),
      db.select().from(leads).where(org).orderBy(desc(leads.createdAt)).limit(100), db.select().from(campaigns).where(campaignOrg).orderBy(desc(campaigns.createdAt)).limit(25),
      db.select({ campaignId: campaignLeads.campaignId, status: campaignLeads.status, value: count() }).from(campaignLeads).innerJoin(campaigns, eq(campaignLeads.campaignId, campaigns.id)).where(campaignOrg).groupBy(campaignLeads.campaignId, campaignLeads.status),
      db.select({ id: calls.id, twilioCallSid: calls.twilioCallSid, status: calls.status, outcome: calls.outcome, startedAt: calls.startedAt, endedAt: calls.endedAt, durationSeconds: calls.durationSeconds, summary: calls.summary, firstName: leads.firstName, lastName: leads.lastName, company: leads.company }).from(calls).innerJoin(leads, eq(calls.leadId, leads.id)).where(callOrg).orderBy(desc(calls.createdAt)).limit(50),
      db.select({ id: appointments.id, subject: appointments.subject, startAt: appointments.startAt, endAt: appointments.endAt, timezone: appointments.timezone, attendeeEmail: appointments.attendeeEmail, joinUrl: appointments.joinUrl, status: appointments.status, firstName: leads.firstName, lastName: leads.lastName, company: leads.company }).from(appointments).innerJoin(leads, eq(appointments.leadId, leads.id)).where(appointmentOrg).orderBy(desc(appointments.startAt)).limit(50),
      hasPermission(auth, "audit:read") ? db.select().from(auditEvents).where(auditOrg).orderBy(desc(auditEvents.createdAt)).limit(30) : Promise.resolve([]), getCalendarStatus(db, auth.organizationId, auth.userId), listVisibleIntegrations(db, auth.organizationId, auth.userId),
      db.select({ value: count() }).from(memberships).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.status, "active"))), db.select().from(usageCounters).where(and(eq(usageCounters.organizationId, auth.organizationId), eq(usageCounters.periodKey, monthlyPeriodKey()))).limit(1), db.select({ stripeCustomerId: organizations.stripeCustomerId, currentPeriodEnd: organizations.currentPeriodEnd }).from(organizations).where(eq(organizations.id, auth.organizationId)).limit(1),
      db.select({ leadId: prospectOutreachEvents.leadId, occurredAt: prospectOutreachEvents.occurredAt }).from(prospectOutreachEvents).where(eq(prospectOutreachEvents.organizationId, auth.organizationId)).orderBy(desc(prospectOutreachEvents.occurredAt)).limit(5000),
    ]);
    const queueByCampaign = new Map<string, Record<string, number>>(); for (const row of queueRows) { const current = queueByCampaign.get(row.campaignId) ?? {}; current[row.status] = Number(row.value); queueByCampaign.set(row.campaignId, current); }
    const config = integrationReadiness(runtime); const twilioConnection = connections.find((item) => item.provider === "twilio" && item.status === "connected"); const openaiConnection = connections.find((item) => item.provider === "openai" && item.status === "connected");
    const callingLimits = await resolveCallingLimits(db, runtime, auth.organizationId, auth.plan).catch(() => ({ providerConcurrent: 1, providerCps: 1, planConcurrent: auth.plan.concurrentCalls, effectiveConcurrent: 1, effectiveCps: 1, maxAiCallSeconds: 900 }));
    const readiness = { twilio: Boolean(twilioConnection) || config.twilio, openai: Boolean(openaiConnection) || config.openai, calendar: calendar.connected, eligibleProspects: Number(eligibleRows[0]?.value ?? 0) > 0, baseUrl: config.baseUrl };
    return Response.json({
      viewer: { userId: auth.userId, displayName: auth.displayName, email: auth.email, role: auth.role, platformRole: auth.platformRole, permissions: EXPOSED_PERMISSIONS.filter((permission) => hasPermission(auth, permission)) },
      workspace: { id: auth.organizationId, name: auth.organizationName, planKey: auth.planKey, plan: auth.plan, subscriptionStatus: auth.subscriptionStatus, trialEndsAt: auth.trialEndsAt, billingOverrideType: auth.billingOverrideType, billingDiscountPercent: auth.billingDiscountPercent, billingOverrideStartsAt: auth.billingOverrideStartsAt, billingOverrideEndsAt: auth.billingOverrideEndsAt, memberCount: Number(memberRows[0]?.value ?? 0), stripeConfigured: config.stripe, hasBillingAccount: Boolean(organizationRows[0]?.stripeCustomerId), currentPeriodEnd: organizationRows[0]?.currentPeriodEnd ?? null, usage: usageRows[0] ?? { periodKey: monthlyPeriodKey(), contactsImported: 0, callsStarted: 0, callMinutes: 0, aiTurns: 0 } },
      metrics: { eligible: Number(eligibleRows[0]?.value ?? 0), blocked: Number(blockedRows[0]?.value ?? 0), active: Number(activeRows[0]?.value ?? 0), booked: Number(bookedRows[0]?.value ?? 0) }, leads: leadRows.map((lead) => { const events = outreachRows.filter((event) => event.leadId === lead.id); return { ...lead, blockReasons: safeJsonArray(lead.blockReasonsJson), phoneE164: maskPhone(lead.phoneE164), outreachCount: events.length, lastOutreachAt: events[0]?.occurredAt ?? null }; }), campaigns: campaignRows.map((campaign) => ({ ...campaign, maxConcurrent: callingLimits.effectiveConcurrent, callsPerSecond: callingLimits.effectiveCps, queue: queueByCampaign.get(campaign.id) ?? {} })), calls: callRows, appointments: appointmentRows, auditEvents: auditRows.map((event) => ({ ...event, details: safeJsonObject(event.detailsJson) })),
      integrations: { calendar, outlook: { connected: calendar.provider === "microsoft", accountEmail: calendar.provider === "microsoft" ? calendar.accountEmail : null }, google: { connected: calendar.provider === "google", accountEmail: calendar.provider === "google" ? calendar.accountEmail : null }, connections, twilio: { configured: readiness.twilio, callingLimits }, openai: { configured: readiness.openai, model: openaiConnection?.accountIdentifier || runtime.OPENAI_MODEL?.trim() || "gpt-5.6-terra" }, appBaseUrl: { configured: config.baseUrl }, providerReadiness: config }, readiness, readinessPassed: Object.values(readiness).filter(Boolean).length,
    });
  } catch (error) { return errorResponse(error, 500); }
}
function safeJsonArray(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function safeJsonObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function maskPhone(value: string): string { return `${value.slice(0, Math.max(2, value.length - 4)).replace(/\d/g, "•")}${value.slice(-4)}`; }
