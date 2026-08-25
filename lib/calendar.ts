import { and, desc, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { createGoogleAppointment, getGoogleAvailableSlots } from "./google-calendar";
import { createOutlookAppointment, getAvailableSlots as getOutlookAvailableSlots, type AvailableSlot } from "./outlook";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;
type CalendarInput = { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string };

export async function getCalendarStatus(db: Db, organizationId: string, userId: string) {
  const connections = await db.select({ provider: integrationConnections.provider, accountIdentifier: integrationConnections.accountIdentifier }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.ownerUserId, userId), eq(integrationConnections.category, "calendar"), eq(integrationConnections.status, "connected"))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt));
  const active = connections.find((item) => item.provider === "microsoft" || item.provider === "google");
  return { connected: Boolean(active), provider: active?.provider ?? null, accountEmail: active?.accountIdentifier ?? null, options: connections };
}

export async function getAvailableSlots(input: CalendarInput & { timezone: string; durationMinutes?: number; count?: number }): Promise<AvailableSlot[]> {
  const provider = await activeProvider(input.db, input.organizationId, input.userId);
  if (provider === "google") return getGoogleAvailableSlots(input);
  return getOutlookAvailableSlots(input);
}

export async function createCalendarAppointment(input: CalendarInput & { appointmentId: string; subject: string; startAt: string; endAt: string; attendeeEmail: string; attendeeName: string; notes: string }) {
  const provider = await activeProvider(input.db, input.organizationId, input.userId);
  if (provider === "google") return createGoogleAppointment(input);
  return createOutlookAppointment(input);
}

async function activeProvider(db: Db, organizationId: string, userId: string): Promise<"microsoft" | "google"> {
  const [connection] = await db.select({ provider: integrationConnections.provider }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.ownerUserId, userId), inArray(integrationConnections.provider, ["microsoft", "google"]), eq(integrationConnections.status, "connected"))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt)).limit(1);
  if (connection?.provider !== "microsoft" && connection?.provider !== "google") throw new Error("Connect Outlook or Google Calendar before calling.");
  return connection.provider;
}
