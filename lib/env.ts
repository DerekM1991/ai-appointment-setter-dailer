import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB: D1Database;
  APP_BASE_URL?: string;
  APP_OWNER_EMAIL?: string;
  APP_ENCRYPTION_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_CALLS_PER_SECOND?: string;
  TWILIO_MAX_CONCURRENT_CALLS?: string;
  TELNYX_API_KEY?: string;
  TELNYX_CONNECTION_ID?: string;
  TELNYX_FROM_NUMBER?: string;
  TELNYX_PUBLIC_KEY?: string;
  TELNYX_CALLS_PER_SECOND?: string;
  TELNYX_MAX_CONCURRENT_CALLS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_PHONE_NUMBER_ID?: string;
  ELEVENLABS_WEBHOOK_SECRET?: string;
  ELEVENLABS_MAX_CONCURRENT_CALLS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  GEMINI_LIVE_VOICE?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_GROWTH?: string;
  STRIPE_PRICE_PRO?: string;
};

export function getRuntimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function normalizedBaseUrl(runtime: RuntimeEnv, request?: Request): string {
  const configured = runtime.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  throw new Error("APP_BASE_URL is not configured.");
}

export function integrationReadiness(runtime: RuntimeEnv) {
  return {
    twilio: Boolean(
      runtime.TWILIO_ACCOUNT_SID &&
        runtime.TWILIO_AUTH_TOKEN &&
        runtime.TWILIO_FROM_NUMBER,
    ),
    openai: Boolean(runtime.OPENAI_API_KEY),
    telnyx: Boolean(
      runtime.TELNYX_API_KEY &&
        runtime.TELNYX_CONNECTION_ID &&
        runtime.TELNYX_FROM_NUMBER &&
        runtime.TELNYX_PUBLIC_KEY,
    ),
    elevenlabs: Boolean(
      runtime.ELEVENLABS_API_KEY &&
        runtime.ELEVENLABS_AGENT_ID &&
        runtime.ELEVENLABS_PHONE_NUMBER_ID &&
        runtime.ELEVENLABS_WEBHOOK_SECRET,
    ),
    gemini: Boolean(runtime.GEMINI_API_KEY),
    microsoft: Boolean(
      runtime.MICROSOFT_CLIENT_ID &&
        runtime.MICROSOFT_CLIENT_SECRET &&
        runtime.APP_ENCRYPTION_KEY,
    ),
    google: Boolean(
      runtime.GOOGLE_CLIENT_ID &&
        runtime.GOOGLE_CLIENT_SECRET &&
        runtime.APP_ENCRYPTION_KEY,
    ),
    stripe: Boolean(
      runtime.STRIPE_SECRET_KEY &&
        runtime.STRIPE_WEBHOOK_SECRET &&
        runtime.STRIPE_PRICE_STARTER &&
        runtime.STRIPE_PRICE_GROWTH &&
        runtime.STRIPE_PRICE_PRO,
    ),
    baseUrl: Boolean(runtime.APP_BASE_URL),
  };
}
