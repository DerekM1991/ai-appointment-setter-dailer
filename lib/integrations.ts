import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeEnv } from "./env";

type Db = ReturnType<typeof getDb>;

export type TwilioCredentials = { accountSid: string; authToken: string; fromNumber: string };
export type OpenAICredentials = { apiKey: string; model: string };

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
  provider: "twilio" | "openai" | "calcom";
  scope: "workspace" | "personal";
  label: string;
  config: Record<string, string>;
}): Promise<string> {
  const key = required(input.runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY");
  const normalized = normalizeConfig(input.provider, input.config);
  await verifyCredential(input.provider, normalized);
  const id = crypto.randomUUID();
  const now = Date.now();
  const category = input.provider === "twilio" ? "telephony" : input.provider === "openai" ? "ai" : "calendar";
  await input.db.insert(integrationConnections).values({
    id,
    organizationId: input.organizationId,
    ownerUserId: input.scope === "personal" ? input.userId : null,
    provider: input.provider,
    category,
    scope: input.scope,
    label: input.label.slice(0, 100),
    accountIdentifier: identifierFor(input.provider, normalized),
    encryptedConfig: await encryptJson(normalized, key),
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
  const config = await defaultConfig<TwilioCredentials>(db, runtime, organizationId, "twilio");
  if (config) return config;
  return {
    accountSid: required(runtime.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID"),
    authToken: required(runtime.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN"),
    fromNumber: required(runtime.TWILIO_FROM_NUMBER, "TWILIO_FROM_NUMBER"),
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

async function defaultConfig<T>(db: Db, runtime: RuntimeEnv, organizationId: string, provider: "twilio" | "openai"): Promise<T | null> {
  const [connection] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, provider), eq(integrationConnections.scope, "workspace"), eq(integrationConnections.status, "connected"), isNull(integrationConnections.ownerUserId))).orderBy(desc(integrationConnections.isDefault), desc(integrationConnections.updatedAt)).limit(1);
  if (!connection) return null;
  return decryptJson<T>(connection.encryptedConfig, required(runtime.APP_ENCRYPTION_KEY, "APP_ENCRYPTION_KEY"));
}

function normalizeConfig(provider: "twilio" | "openai" | "calcom", config: Record<string, string>): Record<string, string> {
  if (provider === "twilio") {
    const accountSid = config.accountSid?.trim();
    const authToken = config.authToken?.trim();
    const fromNumber = config.fromNumber?.trim();
    if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid || "")) throw new Error("Enter a valid Twilio Account SID.");
    if (!authToken || authToken.length < 20) throw new Error("Enter a valid Twilio auth token.");
    if (!/^\+[1-9]\d{7,14}$/.test(fromNumber || "")) throw new Error("Enter a valid E.164 Twilio number.");
    return { accountSid, authToken, fromNumber };
  }
  if (provider === "openai") {
    const apiKey = config.apiKey?.trim();
    const model = config.model?.trim() || "gpt-5.6-terra";
    if (!apiKey || apiKey.length < 20) throw new Error("Enter a valid OpenAI API key.");
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(model)) throw new Error("Enter a valid model identifier.");
    return { apiKey, model };
  }
  const apiKey = config.apiKey?.trim();
  const bookingUrl = config.bookingUrl?.trim();
  if (!apiKey || apiKey.length < 16) throw new Error("Enter a valid Cal.com API key.");
  if (!bookingUrl || !/^https:\/\//.test(bookingUrl)) throw new Error("Enter a valid HTTPS booking URL.");
  return { apiKey, bookingUrl };
}

async function verifyCredential(provider: "twilio" | "openai" | "calcom", config: Record<string, string>) {
  if (provider === "twilio") {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`, { headers: { authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}` } });
    if (!response.ok) throw new Error("Twilio rejected these credentials.");
  } else if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${config.apiKey}` } });
    if (!response.ok) throw new Error("OpenAI rejected this API key.");
  }
}

function identifierFor(provider: string, config: Record<string, string>): string | null {
  if (provider === "twilio") return `${config.accountSid.slice(0, 6)}…${config.fromNumber.slice(-4)}`;
  if (provider === "openai") return config.model;
  return config.bookingUrl || null;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}
