import type { getDb } from "@/db";
import type { RuntimeEnv } from "./env";
import { MAX_CONCURRENT_CALLS } from "./compliance";
import { resolveTwilioCredentials } from "./integrations";
import type { PlanDefinition } from "./plans";

type Db = ReturnType<typeof getDb>;

export const MAX_AI_CALL_SECONDS = 15 * 60;

export async function resolveCallingLimits(db: Db, runtime: RuntimeEnv, organizationId: string, plan: PlanDefinition) {
  const twilio = await resolveTwilioCredentials(db, runtime, organizationId);
  const providerConcurrent = clamp(twilio.maxConcurrentCalls, 1, MAX_CONCURRENT_CALLS);
  const providerCps = clamp(twilio.callsPerSecond, 1, 5);
  return {
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
