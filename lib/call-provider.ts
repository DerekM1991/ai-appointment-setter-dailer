import type { getDb } from "@/db";
import { buildDisclosureGreeting, buildLiveAgentPrompt, createAgentToolToken, type AgentStackContext } from "./agent-stack";
import { createElevenLabsSipCall } from "./elevenlabs";
import type { RuntimeEnv } from "./env";
import {
  resolveElevenLabsCredentials,
  resolveGeminiCredentials,
  resolveOpenAICredentials,
  resolveTelnyxCredentials,
  resolveTwilioCredentials,
  type AiProvider,
  type TelephonyProvider,
} from "./integrations";
import { assertSupportedVoiceStack } from "./provider-stacks";
import { createMediaToken, createTelnyxCall } from "./telnyx";
import { createTwilioCall } from "./twilio";

type Db = ReturnType<typeof getDb>;

export async function createProviderCall(input: {
  db: Db;
  runtime: RuntimeEnv;
  organizationId: string;
  telephonyProvider: TelephonyProvider;
  aiProvider: AiProvider;
  callId: string;
  to: string;
  baseUrl: string;
  timeLimitSeconds: number;
  context: AgentStackContext;
}): Promise<{ providerCallId: string; status: string; twilioCallSid: string | null }> {
  assertSupportedVoiceStack(input.telephonyProvider, input.aiProvider);
  if (input.telephonyProvider === "twilio" && input.aiProvider === "openai") {
    const [twilio, openai] = await Promise.all([
      resolveTwilioCredentials(input.db, input.runtime, input.organizationId),
      resolveOpenAICredentials(input.db, input.runtime, input.organizationId),
    ]);
    const call = await createTwilioCall({
      ...input.runtime,
      TWILIO_ACCOUNT_SID: twilio.accountSid,
      TWILIO_AUTH_TOKEN: twilio.authToken,
      TWILIO_FROM_NUMBER: twilio.fromNumber,
      OPENAI_API_KEY: openai.apiKey,
      OPENAI_MODEL: openai.model,
    }, {
      to: input.to,
      voiceUrl: `${input.baseUrl}/api/twilio/voice?callId=${encodeURIComponent(input.callId)}`,
      statusCallbackUrl: `${input.baseUrl}/api/twilio/status?callId=${encodeURIComponent(input.callId)}`,
      timeLimitSeconds: input.timeLimitSeconds,
    });
    return { providerCallId: call.sid, twilioCallSid: call.sid, status: call.status };
  }

  const telnyx = await resolveTelnyxCredentials(input.db, input.runtime, input.organizationId);
  if (input.aiProvider === "elevenlabs") {
    const elevenlabs = await resolveElevenLabsCredentials(input.db, input.runtime, input.organizationId);
    const secret = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
    const call = await createElevenLabsSipCall(elevenlabs, {
      to: input.to,
      callId: input.callId,
      toolToken: await createAgentToolToken(secret, input.callId),
      toolUrl: `${input.baseUrl}/api/agent-tools/elevenlabs`,
      greeting: buildDisclosureGreeting(input.context),
      systemPrompt: buildLiveAgentPrompt(input.context),
      dynamicVariables: {
        prospect_first_name: input.context.lead.firstName,
        prospect_last_name: input.context.lead.lastName,
        prospect_email: input.context.lead.email || "",
        prospect_timezone: input.context.lead.timezone,
        seller_name: input.context.campaign.sellerName,
        product_name: input.context.campaign.productName,
        appointment_duration_minutes: String(input.context.campaign.meetingDurationMinutes),
      },
    });
    return { providerCallId: call.id, twilioCallSid: null, status: call.status };
  }

  await resolveGeminiCredentials(input.db, input.runtime, input.organizationId);
  const secret = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const mediaToken = await createMediaToken(secret, input.callId);
  const streamBase = input.baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const call = await createTelnyxCall(telnyx, {
    to: input.to,
    callId: input.callId,
    webhookUrl: `${input.baseUrl}/api/telnyx/events?callId=${encodeURIComponent(input.callId)}`,
    streamUrl: `${streamBase}/api/telnyx/media?callId=${encodeURIComponent(input.callId)}&token=${encodeURIComponent(mediaToken)}`,
    timeLimitSeconds: input.timeLimitSeconds,
  });
  return { providerCallId: call.id, twilioCallSid: null, status: call.status };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}
