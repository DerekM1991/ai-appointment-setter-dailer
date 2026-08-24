import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB: D1Database;
  APP_BASE_URL?: string;
  APP_OWNER_EMAIL?: string;
  APP_ENCRYPTION_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
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
    microsoft: Boolean(
      runtime.MICROSOFT_CLIENT_ID &&
        runtime.MICROSOFT_CLIENT_SECRET &&
        runtime.APP_ENCRYPTION_KEY,
    ),
    baseUrl: Boolean(runtime.APP_BASE_URL),
  };
}
