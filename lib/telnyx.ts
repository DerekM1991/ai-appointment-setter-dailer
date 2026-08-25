import type { TelnyxCredentials } from "./integrations";

export type TelnyxCallInput = {
  to: string;
  webhookUrl: string;
  streamUrl: string;
  callId: string;
  timeLimitSeconds?: number;
};

export async function createTelnyxCall(credentials: TelnyxCredentials, input: TelnyxCallInput): Promise<{ id: string; status: string }> {
  const response = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      connection_id: credentials.connectionId,
      to: input.to,
      from: credentials.fromNumber,
      webhook_url: input.webhookUrl,
      webhook_url_method: "POST",
      stream_url: input.streamUrl,
      stream_track: "inbound_track",
      stream_codec: "L16",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "L16",
      stream_bidirectional_target_legs: "self",
      stream_bidirectional_sampling_rate: 24000,
      stream_establish_before_call_originate: false,
      send_silence_when_idle: true,
      timeout_secs: 30,
      time_limit_secs: input.timeLimitSeconds ?? 900,
      client_state: bytesToBase64(new TextEncoder().encode(JSON.stringify({ callId: input.callId }))),
    }),
  });
  const payload = (await response.json()) as { data?: { call_control_id?: string; state?: string }; errors?: Array<{ detail?: string }> };
  if (!response.ok || !payload.data?.call_control_id) {
    throw new Error(`Telnyx call creation failed (${response.status}): ${payload.errors?.[0]?.detail || "Unknown error"}`);
  }
  return { id: payload.data.call_control_id, status: "initiated" };
}

export async function hangupTelnyxCall(credentials: TelnyxCredentials, callControlId: string): Promise<void> {
  const response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
    method: "POST",
    headers: { authorization: `Bearer ${credentials.apiKey}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(`Telnyx hangup failed (${response.status}).`);
  }
}

export async function validateTelnyxRequest(rawBody: string, signature: string | null, timestamp: string | null, publicKey: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!signature || !timestamp || !publicKey) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > 300) return false;
  try {
    const keyBytes = Uint8Array.from(decodePublicKey(publicKey));
    const signatureBytes = Uint8Array.from(base64ToBytes(signature));
    const messageBytes = Uint8Array.from(new TextEncoder().encode(`${timestamp}|${rawBody}`));
    const key = await crypto.subtle.importKey("raw", keyBytes.buffer, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes.buffer,
      messageBytes.buffer,
    );
  } catch {
    return false;
  }
}

export async function createMediaToken(secret: string, callId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`telnyx-media:${callId}`))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function validateMediaToken(secret: string, callId: string, supplied: string | null): Promise<boolean> {
  if (!supplied) return false;
  return timingSafeEqual(await createMediaToken(secret, callId), supplied);
}

export function swapPcm16Endianness(base64: string): string {
  const bytes = base64ToBytes(base64);
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const first = bytes[index];
    bytes[index] = bytes[index + 1];
    bytes[index + 1] = first;
  }
  return bytesToBase64(bytes);
}

function decodePublicKey(value: string): Uint8Array {
  const normalized = value.includes("BEGIN PUBLIC KEY")
    ? value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "")
    : value.trim();
  const decoded = /^[a-fA-F0-9]{64}$/.test(normalized)
    ? Uint8Array.from(normalized.match(/.{2}/g) ?? [], (hex) => Number.parseInt(hex, 16))
    : base64ToBytes(normalized);
  // A PEM SubjectPublicKeyInfo Ed25519 key ends with the 32-byte raw key.
  return decoded.length === 32 ? decoded : decoded.slice(-32);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
