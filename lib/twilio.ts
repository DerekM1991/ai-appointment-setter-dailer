import type { RuntimeEnv } from "./env";

export type TwilioCallInput = {
  to: string;
  voiceUrl: string;
  statusCallbackUrl: string;
};

export async function createTwilioCall(
  runtime: RuntimeEnv,
  input: TwilioCallInput,
): Promise<{ sid: string; status: string }> {
  const accountSid = required(runtime.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID");
  const authToken = required(runtime.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN");
  const from = required(runtime.TWILIO_FROM_NUMBER, "TWILIO_FROM_NUMBER");
  const body = new URLSearchParams({
    To: input.to,
    From: from,
    Url: input.voiceUrl,
    Method: "POST",
    StatusCallback: input.statusCallbackUrl,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
  });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Twilio call creation failed (${response.status}): ${String(payload.message ?? "Unknown error")}`,
    );
  }
  return { sid: String(payload.sid), status: String(payload.status ?? "queued") };
}

export async function validateTwilioRequest(
  request: Request,
  authToken: string | undefined,
  params?: URLSearchParams,
): Promise<boolean> {
  if (!authToken) return false;
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;
  let material = request.url;
  if (params) {
    const keys = [...new Set([...params.keys()])].sort();
    for (const key of keys) {
      for (const value of params.getAll(key).sort()) material += `${key}${value}`;
    }
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(material),
  );
  return timingSafeEqual(bytesToBase64(new Uint8Array(digest)), signature);
}

export function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
