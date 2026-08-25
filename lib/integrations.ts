import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;

export type TelephonyProvider = "twilio" | "telnyx";
export type AiProvider = "openai" | "elevenlabs" | "gemini";
export type CredentialProvider = TelephonyProvider | AiProvider | "calcom";

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  callsPerSecond: number;
  maxConcurrentCalls: number;
};

export type TelnyxCredentials = {
  apiKey: string;
  connectionId: string;
  fromNumber: string;
  publicKey: string;
  callsPerSecond: number;
  maxConcurrentCalls: number;
};

export type OpenAICredentials = { apiKey: string; model: string };
export type ElevenLabsCredentials = {
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
  webhookSecret: string;
  maxConcurrentCalls: number;
};
export type GeminiCredentials = { apiKey: string; model: string; voice: string };

export async function listVisibleIntegrations(db: Db, organizationId: string, userId: string) {
  return db
    .select({
      id: integrationConnections.id,
      provider: integrationConnections.provider,
      category: integrationConnections.category,
      scope: integrationConnections.scope,
      label: integrationConnections.label,
      accountIdentifier: integrationConnections.accountIdentifier,
      status: integrationConnections.status,
      isDefault: integrationConnections.isDefault,
      ownerUserId: integrationConnections.ownerUserId,
      lastVerifiedAt: integrationConnections.lastVerifiedAt,
      updatedAt: integrationConnections.updatedAt,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, organizationId),
        or(eq(integrationConnections.scope, "workspace"), eq(integrationConnections.ownerUserId, userId)),
      ),
    )
    .orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt));
}

export async function saveCredentialIntegration(input: {
  db: Db;
  runtime: RuntimeEnv;
  organizationId: string;
  userId: string;
  provider: CredentialProvider;
  scope: "workspace" | "personal";
  label: string;
  config: Record<string, string>;
}): Promise<string> {
  const key = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const normalized = normalizeConfig(input.provider, input.config);
  const verified = await verifyCredential(input.provider, normalized);
  const savedConfig = { ...normalized, ...verified };
  const id = crypto.randomUUID();
  const now = Date.now();
  await input.db.insert(integrationConnections).values({
    id,
    organizationId: input.organizationId,
    ownerUserId: input.scope === "personal" ? input.userId : null,
    provider: input.provider,
    category: categoryFor(input.provider),
    scope: input.scope,
    label: input.label.slice(0, 100),
    accountIdentifier: identifierFor(input.provider, savedConfig),
    encryptedConfig: await encryptJson(savedConfig, key),
    status: "connected",
    isDefault: true,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function deleteIntegration(db: Db, organizationId: string, id: string, userId: string, canManageWorkspace: boolean): Promise<boolean> {
  const [record] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, organizationId))).limit(1);
  if (!record) return false;
  if (record.scope === "workspace" && !canManageWorkspace) throw new Error("Only an owner or admin can remove workspace integrations.");
  if (record.scope === "personal" && record.ownerUserId !== userId) throw new Error("You can remove only your own personal integrations.");
  await db.delete(integrationConnections).where(eq(integrationConnections.id, id));
  return true;
}

export async function resolveTwilioCredentials(db: Db, runtime: RuntimeEnv, organizationId: string): Promise<TwilioCredentials> {
  const config = await defaultConfig<Record<string, string>>(db, runtime, organizationId, "twilio");
  if (config) return {
    accountSid: config.accountSid,
    authToken: config.authToken,
    fromNumber: config.fromNumber,
    callsPerSecond: boundedNumber(config.callsPerSecond, 1, 5),
    maxConcurrentCalls: boundedNumber(config.maxConcurrentCalls, 1, 20),
  };
  return {
    accountSid: required(runtime.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
    authToken: required(runtime.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN"),
    fromNumber: required(runtime.TWILIO_FROM_NUMBER, "TWILIO_FROM_NUMBER"),
    callsPerSecond: boundedNumber(runtime.TWILIO_CALLS_PER_SECOND, 1, 5),
    maxConcurrentCalls: boundedNumber(runtime.TWILIO_MAX_CONCURRENT_CALLS, 1, 20),
  };
}

export async function resolveTelnyxCredentials(db: Db, runtime: RuntimeEnv, organizationId: string): Promise<TelnyxCredentials> {
  const config = await defaultConfig<Record<string, string>>(db, runtime, organizationId, "telnyx");
  if (config) return {
    apiKey: config.apiKey,
    connectionId: config.connectionId,
    fromNumber: config.fromNumber,
    publicKey: config.publicKey,
    callsPerSecond: boundedNumber(config.callsPerSecond, 1, 10),
    maxConcurrentCalls: boundedNumber(config.maxConcurrentCalls, 1, 20),
  };
  return {
    apiKey: required(runtime.TELNYX_API_KEY, "TELNYX_API_KEY"),
    connectionId: required(runtime.TELNYX_CONNECTION_ID, "TELNYX_CONNECTION_ID"),
    fromNumber: required(runtime.TELNYX_FROM_NUMBER, "TELNYX_FROM_NUMBER"),
    publicKey: required(runtime.TELNYX_PUBLIC_KEY, "TELNYX_PUBLIC_KEY"),
    callsPerSecond: boundedNumber(runtime.TELNYX_CALLS_PER_SECOND, 1, 10),
    maxConcurrentCalls: boundedNumber(runtime.TELNYX_MAX_CONCURRENT_CALLS, 1, 20),
  };
}

export async function resolveOpenAICredentials(db: Db, runtime: RuntimeEnv, organizationId: string): Promise<OpenAICredentials> {
  const config = await defaultConfig<OpenAICredentials>(db, runtime, organizationId, "openai");
  if (config) return config;
  return {
    apiKey: required(runtime.OPENAI_API_KEY, "OPENAI_API_KEY"),
    model: runtime.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
  };
}

export async function resolveElevenLabsCredentials(db: Db, runtime: RuntimeEnv, organizationId: string): Promise<ElevenLabsCredentials> {
  const config = await defaultConfig<Record<string, string>>(db, runtime, organizationId, "elevenlabs");
  if (config) return {
    apiKey: config.apiKey,
    agentId: config.agentId,
    agentPhoneNumberId: config.agentPhoneNumberId,
    webhookSecret: config.webhookSecret,
    maxConcurrentCalls: boundedNumber(config.maxConcurrentCalls, 1, 20),
  };
  return {
    apiKey: required(runtime.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY"),
    agentId: required(runtime.ELEVENLABS_AGENT_ID, "ELEVENLABS_AGENT_ID"),
    agentPhoneNumberId: required(runtime.ELEVENLABS_PHONE_NUMBER_ID, "ELEVENLABS_PHONE_NUMBER_ID"),
    webhookSecret: required(runtime.ELEVENLABS_WEBHOOK_SECRET, "ELEVENLABS_WEBHOOK_SECRET"),
    maxConcurrentCalls: boundedNumber(runtime.ELEVENLABS_MAX_CONCURRENT_CALLS, 1, 20),
  };
}

export async function resolveGeminiCredentials(db: Db, runtime: RuntimeEnv, organizationId: string): Promise<GeminiCredentials> {
  const config = await defaultConfig<GeminiCredentials>(db, runtime, organizationId, "gemini");
  if (config) return config;
  return {
    apiKey: required(runtime.GEMINI_API_KEY, "GEMINI_API_KEY"),
    model: runtime.GEMINI_LIVE_MODEL?.trim() || "gemini-3.1-flash-live-preview",
    voice: runtime.GEMINI_LIVE_VOICE?.trim() || "Kore",
  };
}

export async function hasWorkspaceIntegration(db: Db, runtime: RuntimeEnv, organizationId: string, provider: TelephonyProvider | AiProvider): Promise<boolean> {
  try {
    if (provider === "twilio") await resolveTwilioCredentials(db, runtime, organizationId);
    else if (provider === "telnyx") await resolveTelnyxCredentials(db, runtime, organizationId);
    else if (provider === "openai") await resolveOpenAICredentials(db, runtime, organizationId);
    else if (provider === "elevenlabs") await resolveElevenLabsCredentials(db, runtime, organizationId);
    else await resolveGeminiCredentials(db, runtime, organizationId);
    return true;
  } catch {
    return false;
  }
}

async function defaultConfig<T>(db: Db, runtime: RuntimeEnv, organizationId: string, provider: TelephonyProvider | AiProvider): Promise<T | null> {
  const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, provider), eq(integrationConnections.scope, "workspace"), eq(integrationConnections.status, "connected"), isNull(integrationConnections.ownerUserId))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt)).limit(1);
  if (!connection) return null;
  return decryptJson<T>(connection.encryptedConfig, required(runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY"));
}

function normalizeConfig(provider: CredentialProvider, config: Record<string, string>): Record<string, string> {
  if (provider === "twilio") {
    const accountSid = config.accountSid?.trim();
    const authToken = config.authToken?.trim();
    const fromNumber = config.fromNumber?.trim();
    if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid || "")) throw new Error("Enter a valid Twilio Account SID.");
    if (!authToken || authToken.length < 20) throw new Error("Enter a valid Twilio auth token.");
    if (!isE164(fromNumber)) throw new Error("Enter a valid E.164 Twilio number.");
    return { accountSid, authToken, fromNumber, callsPerSecond: String(boundedNumber(config.callsPerSecond, 1, 5)), maxConcurrentCalls: String(boundedNumber(config.maxConcurrentCalls, 1, 20)) };
  }
  if (provider === "telnyx") {
    const apiKey = config.apiKey?.trim();
    const connectionId = config.connectionId?.trim();
    const fromNumber = config.fromNumber?.trim();
    if (!apiKey || apiKey.length < 20) throw new Error("Enter a valid Telnyx API key.");
    if (!connectionId || !/^[a-zA-Z0-9-]{20,80}$/.test(connectionId)) throw new Error("Enter a valid Telnyx Voice API connection ID.");
    if (!isE164(fromNumber)) throw new Error("Enter a valid E.164 Telnyx number.");
    return { apiKey, connectionId, fromNumber, callsPerSecond: String(boundedNumber(config.callsPerSecond, 1, 10)), maxConcurrentCalls: String(boundedNumber(config.maxConcurrentCalls, 1, 20)) };
  }
  if (provider === "openai") {
    const apiKey = config.apiKey?.trim();
    const model = config.model?.trim() || "gpt-5.6-terra";
    if (!apiKey || apiKey.length < 20) throw new Error("Enter a valid OpenAI API key.");
    if (!isModelId(model)) throw new Error("Enter a valid model identifier.");
    return { apiKey, model };
  }
  if (provider === "elevenlabs") {
    const apiKey = config.apiKey?.trim();
    const agentId = config.agentId?.trim();
    const agentPhoneNumberId = config.agentPhoneNumberId?.trim();
    const webhookSecret = config.webhookSecret?.trim();
    if (!apiKey || apiKey.length < 20) throw new Error("Enter a valid ElevenLabs API key.");
    if (!isExternalId(agentId)) throw new Error("Enter a valid ElevenLabs agent ID.");
    if (!isExternalId(agentPhoneNumberId)) throw new Error("Enter the ElevenLabs phone number ID for your Telnyx SIP trunk.");
    if (!webhookSecret || webhookSecret.length < 20) throw new Error("Enter the HMAC secret from the ElevenLabs post-call webhook.");
    return { apiKey, agentId, agentPhoneNumberId, webhookSecret, maxConcurrentCalls: String(boundedNumber(config.maxConcurrentCalls, 1, 20)) };
  }
  if (provider === "gemini") {
    const apiKey = config.apiKey?.trim();
    const model = config.model?.trim() || "gemini-3.1-flash-live-preview";
    const voice = config.voice?.trim() || "Kore";
    if (!apiKey || apiKey.length < 20) throw new Error("Enter a valid Gemini API key.");
    if (!isModelId(model)) throw new Error("Enter a valid Gemini Live model identifier.");
    if (!/^[a-zA-Z]{2,30}$/.test(voice)) throw new Error("Choose a valid Gemini voice.");
    return { apiKey, model, voice };
  }
  const apiKey = config.apiKey?.trim();
  const bookingUrl = config.bookingUrl?.trim();
  if (!apiKey || apiKey.length < 16) throw new Error("Enter a valid Cal.com API key.");
  if (!bookingUrl || !/^https:\/\//.test(bookingUrl)) throw new Error("Enter a valid HTTPS booking URL.");
  return { apiKey, bookingUrl };
}

async function verifyCredential(provider: CredentialProvider, config: Record<string, string>): Promise<Record<string, string>> {
  if (provider === "twilio") {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`, { headers: { authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}` } });
    if (!response.ok) throw new Error("Twilio rejected these credentials.");
  } else if (provider === "telnyx") {
    const response = await fetch("https://api.telnyx.com/v2/public_key", { headers: { authorization: `Bearer ${config.apiKey}` } });
    const payload = (await response.json()) as { data?: { public?: string } };
    if (!response.ok || !payload.data?.public) throw new Error("Telnyx rejected this API key or did not return a webhook public key.");
    return { publicKey: payload.data.public };
  } else if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok) throw new Error("OpenAI rejected this API key.");
  } else if (provider === "elevenlabs") {
    const headers = { "xi-api-key": config.apiKey };
    const [agent, phone] = await Promise.all([
      fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(config.agentId)}`, { headers }),
      fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${encodeURIComponent(config.agentPhoneNumberId)}`, { headers }),
    ]);
    if (!agent.ok) throw new Error("ElevenLabs could not access that agent.");
    if (!phone.ok) throw new Error("ElevenLabs could not access that SIP phone number.");
  } else if (provider === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}?key=${encodeURIComponent(config.apiKey)}`);
    if (!response.ok) throw new Error("Gemini rejected this API key or Live model.");
  }
  return {};
}

function categoryFor(provider: CredentialProvider): "telephony" | "ai" | "calendar" {
  if (provider === "twilio" || provider === "telnyx") return "telephony";
  if (provider === "openai" || provider === "elevenlabs" || provider === "gemini") return "ai";
  return "calendar";
}

function identifierFor(provider: CredentialProvider, config: Record<string, string>): string | null {
  if (provider === "twilio") return `${config.accountSid.slice(0, 6)}…${config.fromNumber.slice(-4)}`;
  if (provider === "telnyx") return `Voice API · ${config.fromNumber.slice(-4)}`;
  if (provider === "openai" || provider === "gemini") return config.model;
  if (provider === "elevenlabs") return `${config.agentId.slice(0, 8)}… · SIP ${config.agentPhoneNumberId.slice(-6)}`;
  return config.bookingUrl || null;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function boundedNumber(value: string | number | undefined, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : minimum;
}

function isE164(value: string | undefined): value is string {
  return /^\+[1-9]\d{7,14}$/.test(value || "");
}

function isModelId(value: string): boolean {
  return /^[a-zA-Z0-9._-]{2,100}$/.test(value);
}

function isExternalId(value: string | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]{6,160}$/.test(value));
}
