import test from "node:test";
import assert from "node:assert/strict";
import { createAgentToolToken, validateAgentToolToken } from "../lib/agent-stack.ts";
import { validateElevenLabsSignature } from "../lib/elevenlabs.ts";
import { normalizeVoiceStack, voiceStackFor } from "../lib/provider-stacks.ts";
import { createMediaToken, swapPcm16Endianness, validateMediaToken, validateTelnyxRequest } from "../lib/telnyx.ts";

test("normalizes supported voice stacks and falls back safely", () => {
  assert.deepEqual(normalizeVoiceStack("telnyx_elevenlabs"), { telephonyProvider: "telnyx", aiProvider: "elevenlabs" });
  assert.equal(voiceStackFor("telnyx", "gemini").key, "telnyx_gemini");
  assert.deepEqual(normalizeVoiceStack("unknown"), { telephonyProvider: "twilio", aiProvider: "openai" });
});

test("creates call-scoped agent and media tokens", async () => {
  const secret = "test-secret-that-is-long-enough";
  const toolToken = await createAgentToolToken(secret, "call-1");
  assert.equal(await validateAgentToolToken(secret, "call-1", toolToken), true);
  assert.equal(await validateAgentToolToken(secret, "call-2", toolToken), false);
  const mediaToken = await createMediaToken(secret, "call-1");
  assert.equal(await validateMediaToken(secret, "call-1", mediaToken), true);
  assert.equal(await validateMediaToken(secret, "call-2", mediaToken), false);
});

test("validates ElevenLabs post-call HMAC and rejects stale signatures", async () => {
  const secret = "another-test-webhook-secret";
  const timestamp = 1_800_000_000;
  const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "conv_1" } });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
  const signature = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assert.equal(await validateElevenLabsSignature(body, `t=${timestamp},v0=${signature}`, secret, timestamp + 30), true);
  assert.equal(await validateElevenLabsSignature(body, `t=${timestamp},v0=${signature}`, secret, timestamp + 301), false);
});

test("validates Telnyx Ed25519 signatures and converts PCM endianness", async () => {
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const timestamp = 1_800_000_000;
  const body = JSON.stringify({ data: { event_type: "call.answered" } });
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(`${timestamp}|${body}`)));
  assert.equal(await validateTelnyxRequest(body, toBase64(signature), String(timestamp), toBase64(publicKey), timestamp + 10), true);
  assert.equal(await validateTelnyxRequest(`${body} `, toBase64(signature), String(timestamp), toBase64(publicKey), timestamp + 10), false);
  assert.equal(swapPcm16Endianness(toBase64(Uint8Array.from([1, 2, 3, 4]))), toBase64(Uint8Array.from([2, 1, 4, 3])));
});

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
