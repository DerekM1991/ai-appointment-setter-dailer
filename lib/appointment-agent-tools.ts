import { and, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { appointments, campaignLeads, campaigns, calls, leads, prospectOutreachEvents } from "@/db/schema";
import { writeAuditEvent } from "./audit";
import { createCalendarAppointment, getAvailableSlots } from "./calendar";
import { isExplicitBookingConfirmation, isValidEmail } from "./compliance";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;

export type AppointmentAgentTool = "list_slots" | "book_appointment" | "opt_out" | "end_call";

export async function getAgentCallContext(db: Db, callId: string) {
  const [record] = await db
    .select({
      callId: calls.id,
      providerCallId: calls.providerCallId,
      organizationId: calls.organizationId,
      campaignId: campaigns.id,
      leadId: leads.id,
      calendarUserId: campaigns.createdByUserId,
      firstName: leads.firstName,
      lastName: leads.lastName,
      company: leads.company,
      title: leads.title,
      email: leads.email,
      timezone: leads.timezone,
      internalDnc: leads.internalDnc,
      sellerName: campaigns.sellerName,
      productName: campaigns.productName,
      agentName: campaigns.agentName,
      productSummary: campaigns.productSummary,
      objective: campaigns.objective,
      meetingDurationMinutes: campaigns.meetingDurationMinutes,
      telephonyProvider: calls.telephonyProvider,
      aiProvider: calls.aiProvider,
      transcriptJson: calls.transcriptJson,
      callStatus: calls.status,
      appointmentId: calls.appointmentId,
    })
    .from(calls)
    .innerJoin(leads, eq(calls.leadId, leads.id))
    .innerJoin(campaigns, eq(calls.campaignId, campaigns.id))
    .where(eq(calls.id, callId))
    .limit(1);
  if (!record || !record.calendarUserId || !record.timezone || record.internalDnc || !["creating", "queued", "initiated", "ringing", "answered", "in-progress"].includes(record.callStatus)) {
    throw new Error("This call is not authorized for agent actions.");
  }
  return { ...record, calendarUserId: record.calendarUserId as string, timezone: record.timezone as string };
}

export async function executeAppointmentAgentTool(input: {
  db: Db;
  runtime: RuntimeEnv;
  callId: string;
  tool: AppointmentAgentTool;
  arguments: Record<string, unknown>;
}) {
  const context = await getAgentCallContext(input.db, input.callId);
  if (input.tool === "list_slots") {
    const slots = await getAvailableSlots({
      db: input.db,
      runtime: input.runtime,
      organizationId: context.organizationId,
      userId: context.calendarUserId,
      timezone: context.timezone,
      durationMinutes: context.meetingDurationMinutes,
      count: 3,
    });
    const secret = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
    return {
      ok: true,
      slots: await Promise.all(slots.map(async (slot) => ({
        ...slot,
        slotToken: await createSlotToken(secret, input.callId, slot.startAt, slot.endAt, slot.timezone),
      }))),
      instruction: slots.length ? "Offer only these exact slots and retain each slotToken for booking." : "No verified slots are currently available.",
    };
  }
  if (input.tool === "book_appointment") {
    return bookAppointment(input.db, input.runtime, context, input.arguments);
  }
  if (input.tool === "opt_out") {
    const now = Date.now();
    await input.db.update(leads).set({ internalDnc: true, consentStatus: "revoked", status: "blocked", crmStage: "do_not_contact", blockReasonsJson: JSON.stringify(["internal_do_not_call"]), updatedAt: now }).where(eq(leads.id, context.leadId));
    await input.db.update(campaignLeads).set({ status: "completed" }).where(and(eq(campaignLeads.campaignId, context.campaignId), eq(campaignLeads.leadId, context.leadId)));
    await input.db.update(calls).set({ outcome: "opted_out", optOutDetectedAt: now, summary: "The prospect requested no further calls and was added to the internal suppression list.", updatedAt: now }).where(eq(calls.id, context.callId));
    await input.db.update(prospectOutreachEvents).set({ outcome: "opted_out", status: "completed", updatedAt: now }).where(eq(prospectOutreachEvents.callId, context.callId));
    await writeAuditEvent(input.db, { organizationId: context.organizationId, actor: "system:agent", eventType: "prospect_opted_out", entityType: "lead", entityId: context.leadId, details: { callId: context.callId, source: String(input.arguments.source || "agent_tool") } });
    return { ok: true, action: "end_call", message: "Opt-out enforced. Confirm suppression briefly, then end immediately." };
  }
  const outcome = safeText(input.arguments.outcome, 80) || "ended";
  const summary = safeText(input.arguments.summary, 500) || "The conversation ended without an appointment.";
  await input.db.update(calls).set({ outcome, summary, updatedAt: Date.now() }).where(eq(calls.id, context.callId));
  await input.db.update(prospectOutreachEvents).set({ outcome, status: "completed", notes: summary, updatedAt: Date.now() }).where(eq(prospectOutreachEvents.callId, context.callId));
  return { ok: true, action: "end_call" };
}

async function bookAppointment(db: Db, runtime: RuntimeEnv, context: Awaited<ReturnType<typeof getAgentCallContext>>, args: Record<string, unknown>) {
  if (context.appointmentId) throw new Error("This call already has an appointment.");
  const startAt = safeText(args.startAt, 80);
  const endAt = safeText(args.endAt, 80);
  const timezone = safeText(args.timezone, 80);
  const email = (safeText(args.email, 320) || context.email || "").trim().toLowerCase();
  const confirmationText = safeText(args.confirmationText, 500);
  const slotToken = safeText(args.slotToken, 600);
  if (!startAt || !endAt || !timezone || !slotToken) throw new Error("Use an exact slot and slotToken returned by list_slots.");
  if (!isExplicitBookingConfirmation(confirmationText)) throw new Error("The prospect must explicitly confirm the exact offered time before booking.");
  if (!isValidEmail(email)) throw new Error("A valid attendee email is required.");
  const secret = required(runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  if (!(await validateSlotToken(secret, context.callId, startAt, endAt, timezone, slotToken))) throw new Error("The calendar slot token is invalid or does not match the requested time.");
  const appointmentId = crypto.randomUUID();
  const subject = `${context.productName} discovery — ${context.company || `${context.firstName} ${context.lastName}`}`;
  const now = Date.now();
  await db.insert(appointments).values({ id: appointmentId, organizationId: context.organizationId, callId: context.callId, leadId: context.leadId, subject, startAt: Date.parse(startAt), endAt: Date.parse(endAt), timezone, attendeeEmail: email, status: "pending", createdAt: now, updatedAt: now });
  try {
    const event = await createCalendarAppointment({ db, runtime, organizationId: context.organizationId, userId: context.calendarUserId, appointmentId, subject, startAt, endAt, attendeeEmail: email, attendeeName: `${context.firstName} ${context.lastName}`, notes: `Booked by ${context.agentName}, the disclosed AI appointment assistant for ${context.sellerName}, after explicit prospect confirmation.` });
    await db.update(appointments).set({ graphEventId: event.graphEventId, joinUrl: event.joinUrl, status: "confirmed", updatedAt: Date.now() }).where(eq(appointments.id, appointmentId));
    await db.update(leads).set({ email, status: "completed", crmStage: "appointment_set", updatedAt: Date.now() }).where(eq(leads.id, context.leadId));
    await db.update(calls).set({ appointmentId, outcome: "appointment_booked", summary: `The prospect booked ${startAt}.`, updatedAt: Date.now() }).where(eq(calls.id, context.callId));
    await writeAuditEvent(db, { organizationId: context.organizationId, actor: "system:agent", eventType: "appointment_booked", entityType: "appointment", entityId: appointmentId, details: { callId: context.callId, startAt } });
    return { ok: true, status: "confirmed", appointmentId, startAt, endAt, timezone, attendeeEmail: email, joinUrl: event.joinUrl || null, instruction: "The appointment is confirmed. You may tell the prospect it is booked." };
  } catch (error) {
    await db.update(appointments).set({ status: "failed", updatedAt: Date.now() }).where(eq(appointments.id, appointmentId));
    return { ok: false, status: "failed", instruction: "Do not claim the appointment is booked. Offer manual follow-up.", error: error instanceof Error ? error.message.slice(0, 300) : "Calendar booking failed." };
  }
}

async function createSlotToken(secret: string, callId: string, startAt: string, endAt: string, timezone: string): Promise<string> {
  const payload = `${callId}\n${startAt}\n${endAt}\n${timezone}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return toBase64Url(signature);
}

async function validateSlotToken(secret: string, callId: string, startAt: string, endAt: string, timezone: string, supplied: string): Promise<boolean> {
  return timingSafeEqual(await createSlotToken(secret, callId, startAt, endAt, timezone), supplied);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}
