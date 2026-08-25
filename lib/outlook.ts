import { and, desc, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;
type MicrosoftTokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; error?: string; error_description?: string };
type StoredMicrosoftConfig = { accessToken: string; refreshToken: string; expiresAt: number; scopes: string };
export type AvailableSlot = { startAt: string; endAt: string; timezone: string; label: string };

export async function buildOutlookAuthorizationUrl(input: { runtime: RuntimeEnv; redirectUri: string; userEmail: string; userId: string; organizationId: string }): Promise<string> {
  const clientId = required(input.runtime.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID");
  const encryptionKey = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const tenant = input.runtime.MICROSOFT_TENANT_ID?.trim() || "common";
  const state = await encryptJson({ userEmail: input.userEmail, userId: input.userId, organizationId: input.organizationId, nonce: crypto.randomUUID(), expiresAt: Date.now() + 600_000 }, encryptionKey);
  const query = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: input.redirectUri, response_mode: "query", scope: "offline_access User.Read Calendars.ReadWrite", state, prompt: "select_account" });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${query}`;
}

export async function completeOutlookAuthorization(input: { db: Db; runtime: RuntimeEnv; code: string; state: string; redirectUri: string; userEmail: string; userId: string; organizationId: string }): Promise<{ accountEmail: string }> {
  const encryptionKey = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const state = await decryptJson<{ userEmail: string; userId: string; organizationId: string; expiresAt: number }>(input.state, encryptionKey);
  if (state.expiresAt < Date.now() || state.userEmail !== input.userEmail || state.userId !== input.userId || state.organizationId !== input.organizationId) throw new Error("The Outlook connection request expired or belongs to another user.");
  const token = await requestToken(input.runtime, { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri });
  if (!token.refresh_token) throw new Error("Microsoft did not return a refresh token. Reconnect and grant calendar access.");
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error("Could not read the connected Microsoft profile.");
  const profile = (await profileResponse.json()) as { mail?: string; userPrincipalName?: string };
  const accountEmail = profile.mail || profile.userPrincipalName || input.userEmail;
  const now = Date.now();
  const encryptedConfig = await encryptJson({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now + Math.max(60, token.expires_in - 60) * 1000, scopes: token.scope || "offline_access User.Read Calendars.ReadWrite" } satisfies StoredMicrosoftConfig, encryptionKey);
  const [existing] = await input.db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.ownerUserId, input.userId), eq(integrationConnections.provider, "microsoft"))).limit(1);
  if (existing) {
    await input.db.update(integrationConnections).set({ accountIdentifier: accountEmail, encryptedConfig, status: "connected", isDefault: true, lastVerifiedAt: now, updatedAt: now }).where(eq(integrationConnections.id, existing.id));
  } else {
    await input.db.insert(integrationConnections).values({ id: crypto.randomUUID(), organizationId: input.organizationId, ownerUserId: input.userId, provider: "microsoft", category: "calendar", scope: "personal", label: "Microsoft Outlook", accountIdentifier: accountEmail, encryptedConfig, status: "connected", isDefault: true, lastVerifiedAt: now, createdAt: now, updatedAt: now });
  }
  return { accountEmail };
}

export async function getOutlookStatus(db: Db, organizationId: string, userId: string): Promise<{ connected: boolean; accountEmail: string | null }> {
  const [connection] = await db.select({ accountEmail: integrationConnections.accountIdentifier }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.ownerUserId, userId), eq(integrationConnections.provider, "microsoft"), eq(integrationConnections.status, "connected"))).limit(1);
  return { connected: Boolean(connection), accountEmail: connection?.accountEmail ?? null };
}

export async function disconnectOutlook(db: Db, organizationId: string, userId: string): Promise<void> {
  await db.delete(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.ownerUserId, userId), eq(integrationConnections.provider, "microsoft")));
}

export async function getAvailableSlots(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string; timezone: string; durationMinutes?: number; count?: number }): Promise<AvailableSlot[]> {
  const duration = Math.min(60, Math.max(15, input.durationMinutes ?? 30));
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const startRange = roundToNextHalfHour(new Date(Date.now() + 7_200_000));
  const endRange = new Date(startRange.getTime() + 10 * 86_400_000);
  const query = new URLSearchParams({ startDateTime: startRange.toISOString(), endDateTime: endRange.toISOString(), $select: "start,end,showAs,isCancelled", $top: "1000" });
  const response = await graphFetch(input.db, input.runtime, input.organizationId, input.userId, `/me/calendarView?${query}`, { headers: { Prefer: 'outlook.timezone="UTC"' } });
  const payload = (await response.json()) as { value?: Array<{ start?: { dateTime?: string }; end?: { dateTime?: string }; showAs?: string; isCancelled?: boolean }> };
  const busy = (payload.value ?? []).filter((event) => !event.isCancelled && event.showAs !== "free").map((event) => ({ start: Date.parse(event.start?.dateTime ?? ""), end: Date.parse(event.end?.dateTime ?? "") })).filter((event) => Number.isFinite(event.start) && Number.isFinite(event.end));
  const slots: AvailableSlot[] = [];
  for (let cursor = startRange.getTime(); cursor + duration * 60_000 <= endRange.getTime() && slots.length < count; cursor += 1_800_000) {
    const start = new Date(cursor);
    const local = localClockParts(start, input.timezone);
    const localMinutes = local.hour * 60 + local.minute;
    if (local.weekday === "Sat" || local.weekday === "Sun" || localMinutes < 540 || localMinutes + duration > 990) continue;
    const end = new Date(cursor + duration * 60_000);
    if (busy.some((event) => cursor < event.end && end.getTime() > event.start)) continue;
    slots.push({ startAt: start.toISOString(), endAt: end.toISOString(), timezone: input.timezone, label: new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start) });
  }
  return slots;
}

export async function createOutlookAppointment(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string; appointmentId: string; subject: string; startAt: string; endAt: string; attendeeEmail: string; attendeeName: string; notes: string }): Promise<{ graphEventId: string; joinUrl: string | null }> {
  const response = await graphFetch(input.db, input.runtime, input.organizationId, input.userId, "/me/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: input.subject, body: { contentType: "text", content: input.notes }, start: { dateTime: input.startAt, timeZone: "UTC" }, end: { dateTime: input.endAt, timeZone: "UTC" }, attendees: [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName }, type: "required" }], allowNewTimeProposals: true, isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", transactionId: input.appointmentId }) });
  const payload = (await response.json()) as { id?: string; onlineMeeting?: { joinUrl?: string }; onlineMeetingUrl?: string };
  if (!payload.id) throw new Error("Microsoft Graph did not return an event ID.");
  return { graphEventId: payload.id, joinUrl: payload.onlineMeeting?.joinUrl || payload.onlineMeetingUrl || null };
}

async function graphFetch(db: Db, runtime: RuntimeEnv, organizationId: string, userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { authorization: `Bearer ${await validAccessToken(db, runtime, organizationId, userId)}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function validAccessToken(db: Db, runtime: RuntimeEnv, organizationId: string, userId: string): Promise<string> {
  const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.ownerUserId, userId), eq(integrationConnections.provider, "microsoft"), eq(integrationConnections.status, "connected"))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt)).limit(1);
  if (!connection) throw new Error("Outlook is not connected for this user.");
  const encryptionKey = required(runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const stored = await decryptJson<StoredMicrosoftConfig>(connection.encryptedConfig, encryptionKey);
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
  const token = await requestToken(runtime, { grant_type: "refresh_token", refresh_token: stored.refreshToken, scope: "offline_access User.Read Calendars.ReadWrite" });
  const now = Date.now();
  await db.update(integrationConnections).set({ encryptedConfig: await encryptJson({ accessToken: token.access_token, refreshToken: token.refresh_token || stored.refreshToken, expiresAt: now + Math.max(60, token.expires_in - 60) * 1000, scopes: token.scope || stored.scopes } satisfies StoredMicrosoftConfig, encryptionKey), lastVerifiedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id));
  return token.access_token;
}

async function requestToken(runtime: RuntimeEnv, fields: Record<string, string>): Promise<MicrosoftTokenResponse> {
  const tenant = runtime.MICROSOFT_TENANT_ID?.trim() || "common";
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: required(runtime.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID"), client_secret: required(runtime.MICROSOFT_CLIENT_SECRET, "MICROSOFT_CLIENT_SECRET"), ...fields }) });
  const payload = (await response.json()) as MicrosoftTokenResponse;
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "Microsoft OAuth failed.");
  return payload;
}

function localClockParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { weekday: values.weekday, hour: Number(values.hour), minute: Number(values.minute) };
}

function roundToNextHalfHour(value: Date): Date { return new Date(Math.ceil(value.getTime() / 1_800_000) * 1_800_000); }
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is not configured.`); return value; }
