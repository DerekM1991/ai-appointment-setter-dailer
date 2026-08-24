import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { oauthConnections } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;

type MicrosoftTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type StoredToken = { token: string };

export type AvailableSlot = {
  startAt: string;
  endAt: string;
  timezone: string;
  label: string;
};

export async function buildOutlookAuthorizationUrl(input: {
  runtime: RuntimeEnv;
  redirectUri: string;
  userEmail: string;
}): Promise<string> {
  const clientId = required(input.runtime.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID");
  const encryptionKey = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const tenant = input.runtime.MICROSOFT_TENANT_ID?.trim() || "common";
  const state = await encryptJson(
    {
      userEmail: input.userEmail,
      nonce: crypto.randomUUID(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    },
    encryptionKey,
  );
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: "offline_access User.Read Calendars.ReadWrite",
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${query}`;
}

export async function completeOutlookAuthorization(input: {
  db: Db;
  runtime: RuntimeEnv;
  code: string;
  state: string;
  redirectUri: string;
  userEmail: string;
}): Promise<{ accountEmail: string }> {
  const encryptionKey = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const state = await decryptJson<{
    userEmail: string;
    expiresAt: number;
  }>(input.state, encryptionKey);
  if (state.expiresAt < Date.now() || state.userEmail !== input.userEmail) {
    throw new Error("The Outlook connection request expired or belongs to another user.");
  }

  const token = await requestToken(input.runtime, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (!token.refresh_token) {
    throw new Error("Microsoft did not return a refresh token. Reconnect and grant calendar access.");
  }
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) throw new Error("Could not read the connected Microsoft profile.");
  const profile = (await profileResponse.json()) as {
    mail?: string;
    userPrincipalName?: string;
  };
  const accountEmail = profile.mail || profile.userPrincipalName || input.userEmail;
  const now = Date.now();
  await input.db
    .insert(oauthConnections)
    .values({
      provider: "microsoft",
      accountEmail,
      encryptedAccessToken: await encryptJson({ token: token.access_token }, encryptionKey),
      encryptedRefreshToken: await encryptJson({ token: token.refresh_token }, encryptionKey),
      expiresAt: now + Math.max(60, token.expires_in - 60) * 1000,
      scopes: token.scope || "offline_access User.Read Calendars.ReadWrite",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: oauthConnections.provider,
      set: {
        accountEmail,
        encryptedAccessToken: await encryptJson({ token: token.access_token }, encryptionKey),
        encryptedRefreshToken: await encryptJson({ token: token.refresh_token }, encryptionKey),
        expiresAt: now + Math.max(60, token.expires_in - 60) * 1000,
        scopes: token.scope || "offline_access User.Read Calendars.ReadWrite",
        updatedAt: now,
      },
    });
  return { accountEmail };
}

export async function getOutlookStatus(db: Db): Promise<{
  connected: boolean;
  accountEmail: string | null;
}> {
  const [connection] = await db
    .select({ accountEmail: oauthConnections.accountEmail })
    .from(oauthConnections)
    .where(eq(oauthConnections.provider, "microsoft"))
    .limit(1);
  return {
    connected: Boolean(connection),
    accountEmail: connection?.accountEmail ?? null,
  };
}

export async function disconnectOutlook(db: Db): Promise<void> {
  await db.delete(oauthConnections).where(eq(oauthConnections.provider, "microsoft"));
}

export async function getAvailableSlots(input: {
  db: Db;
  runtime: RuntimeEnv;
  timezone: string;
  durationMinutes?: number;
  count?: number;
}): Promise<AvailableSlot[]> {
  const duration = Math.min(60, Math.max(15, input.durationMinutes ?? 30));
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const startRange = roundToNextHalfHour(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const endRange = new Date(startRange.getTime() + 10 * 86_400_000);
  const query = new URLSearchParams({
    startDateTime: startRange.toISOString(),
    endDateTime: endRange.toISOString(),
    $select: "start,end,showAs,isCancelled",
    $top: "1000",
  });
  const response = await graphFetch(
    input.db,
    input.runtime,
    `/me/calendarView?${query}`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } },
  );
  const payload = (await response.json()) as {
    value?: Array<{
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      showAs?: string;
      isCancelled?: boolean;
    }>;
  };
  const busy = (payload.value ?? [])
    .filter((event) => !event.isCancelled && event.showAs !== "free")
    .map((event) => ({
      start: Date.parse(event.start?.dateTime ?? ""),
      end: Date.parse(event.end?.dateTime ?? ""),
    }))
    .filter((event) => Number.isFinite(event.start) && Number.isFinite(event.end));

  const slots: AvailableSlot[] = [];
  for (
    let cursor = startRange.getTime();
    cursor + duration * 60_000 <= endRange.getTime() && slots.length < count;
    cursor += 30 * 60_000
  ) {
    const start = new Date(cursor);
    const local = localClockParts(start, input.timezone);
    const localMinutes = local.hour * 60 + local.minute;
    const endMinutes = localMinutes + duration;
    if (
      local.weekday === "Sat" ||
      local.weekday === "Sun" ||
      localMinutes < 9 * 60 ||
      endMinutes > 16 * 60 + 30
    ) {
      continue;
    }
    const end = new Date(cursor + duration * 60_000);
    if (busy.some((event) => cursor < event.end && end.getTime() > event.start)) continue;
    slots.push({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: input.timezone,
      label: new Intl.DateTimeFormat("en-US", {
        timeZone: input.timezone,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(start),
    });
  }
  return slots;
}

export async function createOutlookAppointment(input: {
  db: Db;
  runtime: RuntimeEnv;
  appointmentId: string;
  subject: string;
  startAt: string;
  endAt: string;
  attendeeEmail: string;
  attendeeName: string;
  notes: string;
}): Promise<{ graphEventId: string; joinUrl: string | null }> {
  const response = await graphFetch(input.db, input.runtime, "/me/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: "text", content: input.notes },
      start: { dateTime: input.startAt, timeZone: "UTC" },
      end: { dateTime: input.endAt, timeZone: "UTC" },
      attendees: [
        {
          emailAddress: {
            address: input.attendeeEmail,
            name: input.attendeeName,
          },
          type: "required",
        },
      ],
      allowNewTimeProposals: true,
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
      transactionId: input.appointmentId,
    }),
  });
  const payload = (await response.json()) as {
    id?: string;
    onlineMeeting?: { joinUrl?: string };
    onlineMeetingUrl?: string;
  };
  if (!payload.id) throw new Error("Microsoft Graph did not return an event ID.");
  return {
    graphEventId: payload.id,
    joinUrl: payload.onlineMeeting?.joinUrl || payload.onlineMeetingUrl || null,
  };
}

async function graphFetch(
  db: Db,
  runtime: RuntimeEnv,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await validAccessToken(db, runtime);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Microsoft Graph request failed (${response.status}): ${message.slice(0, 500)}`);
  }
  return response;
}

async function validAccessToken(db: Db, runtime: RuntimeEnv): Promise<string> {
  const [connection] = await db
    .select()
    .from(oauthConnections)
    .where(eq(oauthConnections.provider, "microsoft"))
    .limit(1);
  if (!connection) throw new Error("Outlook is not connected.");
  const encryptionKey = required(runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  if (connection.expiresAt > Date.now() + 60_000) {
    return (await decryptJson<StoredToken>(connection.encryptedAccessToken, encryptionKey)).token;
  }
  const refreshToken = (
    await decryptJson<StoredToken>(connection.encryptedRefreshToken, encryptionKey)
  ).token;
  const token = await requestToken(runtime, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "offline_access User.Read Calendars.ReadWrite",
  });
  const now = Date.now();
  await db
    .update(oauthConnections)
    .set({
      encryptedAccessToken: await encryptJson({ token: token.access_token }, encryptionKey),
      encryptedRefreshToken: token.refresh_token
        ? await encryptJson({ token: token.refresh_token }, encryptionKey)
        : connection.encryptedRefreshToken,
      expiresAt: now + Math.max(60, token.expires_in - 60) * 1000,
      updatedAt: now,
    })
    .where(eq(oauthConnections.provider, "microsoft"));
  return token.access_token;
}

async function requestToken(
  runtime: RuntimeEnv,
  fields: Record<string, string>,
): Promise<MicrosoftTokenResponse> {
  const tenant = runtime.MICROSOFT_TENANT_ID?.trim() || "common";
  const body = new URLSearchParams({
    client_id: required(runtime.MICROSOFT_CLIENT_ID, "MICROSOFT_CLIENT_ID"),
    client_secret: required(
      runtime.MICROSOFT_CLIENT_SECRET,
      "MICROSOFT_CLIENT_SECRET",
    ),
    ...fields,
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const payload = (await response.json()) as MicrosoftTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "Microsoft OAuth failed.",
    );
  }
  return payload;
}

function localClockParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function roundToNextHalfHour(value: Date): Date {
  const interval = 30 * 60_000;
  return new Date(Math.ceil(value.getTime() / interval) * interval);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}
