import { and, desc, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeEnv } from "./env";
import type { AvailableSlot } from "./outlook";

type Db = ReturnType<typeof getDb>;
type StoredGoogleConfig = { accessToken: string; refreshToken: string; expiresAt: number; scopes: string };
type GoogleToken = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; error?: string; error_description?: string };

export async function buildGoogleAuthorizationUrl(input: { runtime: RuntimeEnv; redirectUri: string; userEmail: string; userId: string; organizationId: string }): Promise<string> {
  const key = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const state = await encryptJson({ userEmail: input.userEmail, userId: input.userId, organizationId: input.organizationId, nonce: crypto.randomUUID(), expiresAt: Date.now() + 600_000 }, key);
  const params = new URLSearchParams({ client_id: required(input.runtime.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"), redirect_uri: input.redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly", state, login_hint: input.userEmail });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeGoogleAuthorization(input: { db: Db; runtime: RuntimeEnv; code: string; state: string; redirectUri: string; userEmail: string; userId: string; organizationId: string }): Promise<{ accountEmail: string }> {
  const key = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const state = await decryptJson<{ userEmail: string; userId: string; organizationId: string; expiresAt: number }>(input.state, key);
  if (state.expiresAt < Date.now() || state.userEmail !== input.userEmail || state.userId !== input.userId || state.organizationId !== input.organizationId) throw new Error("The Google connection request expired or belongs to another user.");
  const token = await requestGoogleToken(input.runtime, { code: input.code, grant_type: "authorization_code", redirect_uri: input.redirectUri });
  if (!token.refresh_token) throw new Error("Google did not return a refresh token. Reconnect and grant offline access.");
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profile.ok) throw new Error("Could not read the connected Google profile.");
  const accountEmail = String(((await profile.json()) as { email?: string }).email || input.userEmail);
  const now = Date.now();
  const encryptedConfig = await encryptJson({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: now + Math.max(60, token.expires_in - 60) * 1000, scopes: token.scope || "calendar" } satisfies StoredGoogleConfig, key);
  const [existing] = await input.db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.ownerUserId, input.userId), eq(integrationConnections.provider, "google"))).limit(1);
  if (existing) await input.db.update(integrationConnections).set({ accountIdentifier: accountEmail, encryptedConfig, status: "connected", isDefault: true, lastVerifiedAt: now, updatedAt: now }).where(eq(integrationConnections.id, existing.id));
  else await input.db.insert(integrationConnections).values({ id: crypto.randomUUID(), organizationId: input.organizationId, ownerUserId: input.userId, provider: "google", category: "calendar", scope: "personal", label: "Google Calendar", accountIdentifier: accountEmail, encryptedConfig, status: "connected", isDefault: true, lastVerifiedAt: now, createdAt: now, updatedAt: now });
  return { accountEmail };
}

export async function getGoogleAvailableSlots(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string; timezone: string; durationMinutes?: number; count?: number }): Promise<AvailableSlot[]> {
  const duration = Math.min(60, Math.max(15, input.durationMinutes ?? 30));
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const start = new Date(Math.ceil((Date.now() + 7_200_000) / 1_800_000) * 1_800_000);
  const endRange = new Date(start.getTime() + 10 * 86_400_000);
  const response = await googleFetch(input, "/calendar/v3/freeBusy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeMin: start.toISOString(), timeMax: endRange.toISOString(), timeZone: "UTC", items: [{ id: "primary" }] }) });
  const payload = (await response.json()) as { calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } } };
  const busy = (payload.calendars?.primary?.busy ?? []).map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }));
  const slots: AvailableSlot[] = [];
  for (let cursor = start.getTime(); cursor + duration * 60_000 <= endRange.getTime() && slots.length < count; cursor += 1_800_000) {
    const at = new Date(cursor);
    const parts = localParts(at, input.timezone);
    const minutes = parts.hour * 60 + parts.minute;
    if (parts.weekday === "Sat" || parts.weekday === "Sun" || minutes < 540 || minutes + duration > 990) continue;
    const end = cursor + duration * 60_000;
    if (busy.some((item) => cursor < item.end && end > item.start)) continue;
    slots.push({ startAt: at.toISOString(), endAt: new Date(end).toISOString(), timezone: input.timezone, label: new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at) });
  }
  return slots;
}

export async function createGoogleAppointment(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string; appointmentId: string; subject: string; startAt: string; endAt: string; attendeeEmail: string; attendeeName: string; notes: string }): Promise<{ graphEventId: string; joinUrl: string | null }> {
  const response = await googleFetch(input, `/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary: input.subject, description: input.notes, start: { dateTime: input.startAt }, end: { dateTime: input.endAt }, attendees: [{ email: input.attendeeEmail, displayName: input.attendeeName }], conferenceData: { createRequest: { requestId: input.appointmentId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }) });
  const payload = (await response.json()) as { id?: string; hangoutLink?: string };
  if (!payload.id) throw new Error("Google Calendar did not return an event ID.");
  return { graphEventId: `google:${payload.id}`, joinUrl: payload.hangoutLink || null };
}

async function googleFetch(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string }, path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`https://www.googleapis.com${path}`, { ...init, headers: { authorization: `Bearer ${await validGoogleAccessToken(input)}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Google Calendar request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function validGoogleAccessToken(input: { db: Db; runtime: RuntimeEnv; organizationId: string; userId: string }): Promise<string> {
  const [connection] = await input.db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, input.organizationId), eq(integrationConnections.ownerUserId, input.userId), eq(integrationConnections.provider, "google"), eq(integrationConnections.status, "connected"))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt)).limit(1);
  if (!connection) throw new Error("Google Calendar is not connected for this user.");
  const key = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const stored = await decryptJson<StoredGoogleConfig>(connection.encryptedConfig, key);
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken;
  const token = await requestGoogleToken(input.runtime, { refresh_token: stored.refreshToken, grant_type: "refresh_token" });
  const now = Date.now();
  await input.db.update(integrationConnections).set({ encryptedConfig: await encryptJson({ accessToken: token.access_token, refreshToken: token.refresh_token || stored.refreshToken, expiresAt: now + Math.max(60, token.expires_in - 60) * 1000, scopes: token.scope || stored.scopes } satisfies StoredGoogleConfig, key), lastVerifiedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id));
  return token.access_token;
}

async function requestGoogleToken(runtime: RuntimeEnv, fields: Record<string, string>): Promise<GoogleToken> {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: required(runtime.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"), client_secret: required(runtime.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"), ...fields }) });
  const payload = (await response.json()) as GoogleToken;
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "Google OAuth failed.");
  return payload;
}

function localParts(at: Date, timezone: string) { const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value])); return { weekday: values.weekday, hour: Number(values.hour), minute: Number(values.minute) }; }
function required(value: string | undefined, name: string): string { if (!value?.trim()) throw new Error(`${name} is not configured.`); return value.trim(); }
