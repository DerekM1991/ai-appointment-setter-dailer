import type { ElevenLabsCredentials } from "./integrations";

export async function createElevenLabsSipCall(credentials: ElevenLabsCredentials, input: {
  to: string;
  callId: string;
  toolToken: string;
  toolUrl: string;
  greeting: string;
  systemPrompt: string;
  dynamicVariables: Record<string, string>;
}): Promise<{ id: string; status: string; sipCallId: string | null }> {
  const response = await fetch("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": credentials.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: credentials.agentId,
      agent_phone_number_id: credentials.agentPhoneNumberId,
      to_number: input.to,
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: input.systemPrompt },
            first_message: input.greeting,
            language: "en",
          },
        },
        dynamic_variables: {
          ...input.dynamicVariables,
          call_id: input.callId,
          appointment_tool_token: input.toolToken,
          appointment_tool_url: input.toolUrl,
        },
      },
    }),
  });
  const payload = (await response.json()) as { success?: boolean; message?: string; conversation_id?: string; sip_call_id?: string; detail?: unknown };
  if (!response.ok || !payload.success || !payload.conversation_id) {
    throw new Error(`ElevenLabs SIP call failed (${response.status}): ${payload.message || stringifyDetail(payload.detail)}`);
  }
  return { id: payload.conversation_id, status: "initiated", sipCallId: payload.sip_call_id || null };
}

export async function validateElevenLabsSignature(rawBody: string, signatureHeader: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const values = Object.fromEntries(signatureHeader.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const timestamp = Number(values.t);
  const signature = values.v0;
  if (!signature || !Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${values.t}.${rawBody}`)));
  return timingSafeEqual(bytesToHex(digest), signature.toLowerCase());
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function stringifyDetail(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return "Unknown error"; }
}
