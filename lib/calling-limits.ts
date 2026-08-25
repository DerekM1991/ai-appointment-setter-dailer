import type { getDb } from "@/db";
import type { RuntimeEnv } from "./env";
import { MAX_CONCURRENT_CALLS } from "./compliance";
import { resolveElevenLabsCredentials, resolveTelnyxCredentials, resolveTwilioCredentials, type AiProvider, type TelephonyProvider } from "./integrations";
import type { PlanDefinition } from "./plans";

type Db = ReturnType<typeof getDb>;

export const MAX_AI_CALL_SECONDS = 15 * 60;

export async function resolveCallingLimits(db: Db, runtime: RuntimeEnv, organizationId: string, plan: PlanDefinition, telephonyProvider: TelephonyProvider = "twilio", aiProvider: AiProvider = "openai") {
  const telephony = telephonyProvider === "telnyx"
    ? await resolveTelnyxCredentials(db, runtime, organizationId)
    : await resolveTwilioCredentials(db, runtime, organizationId);
  const aiConcurrent = aiProvider === "elevenlabs"
    ? (await resolveElevenLabsCredentials(db, runtime, organizationId)).maxConcurrentCalls
    : MAX_CONCURRENT_CALLS;
  const providerConcurrent = clamp(Math.min(telephony.maxConcurrentCalls, aiConcurrent), 1, MAX_CONCURRENT_CALLS);
  const providerCps = clamp(telephony.callsPerSecond, 1, 10);
  return {
    telephonyProvider,
    aiProvider,
    providerName: telephonyProvider === "telnyx" ? "Telnyx" : "Twilio",
    aiName: aiProvider === "elevenlabs" ? "ElevenLabs" : aiProvider === "gemini" ? "Gemini Live" : "OpenAI",
    providerConcurrent,
    providerCps,
    planConcurrent: plan.concurrentCalls,
    effectiveConcurrent: Math.min(MAX_CONCURRENT_CALLS, plan.concurrentCalls, providerConcurrent),
    effectiveCps: providerCps,
    maxAiCallSeconds: MAX_AI_CALL_SECONDS,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.floor(value) : minimum));
}
