import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { organizations } from "@/db/schema";
import type { RuntimeEnv } from "./env";
import type { PlanKey } from "./plans";

type Db = ReturnType<typeof getDb>;

export async function createSubscriptionCheckout(input: {
  db: Db;
  runtime: RuntimeEnv;
  organizationId: string;
  organizationName: string;
  email: string;
  plan: Exclude<PlanKey, "trial">;
  returnUrl: string;
}): Promise<string> {
  const secret = required(input.runtime.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
  const price = priceFor(input.runtime, input.plan);
  const [organization] = await input.db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
  if (!organization) throw new Error("Workspace not found.");
  let customerId = organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripeRequest<{ id: string }>(secret, "/v1/customers", {
      name: input.organizationName,
      email: input.email,
      "metadata[organization_id]": input.organizationId,
    });
    customerId = customer.id;
    await input.db.update(organizations).set({ stripeCustomerId: customerId, updatedAt: Date.now() }).where(eq(organizations.id, input.organizationId));
  }
  const session = await stripeRequest<{ url?: string }>(secret, "/v1/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}billing=success`,
    cancel_url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}billing=cancelled`,
    "metadata[organization_id]": input.organizationId,
    "metadata[plan_key]": input.plan,
    "subscription_data[metadata][organization_id]": input.organizationId,
    "subscription_data[metadata][plan_key]": input.plan,
    allow_promotion_codes: "true",
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createBillingPortal(input: { runtime: RuntimeEnv; customerId: string; returnUrl: string }): Promise<string> {
  const session = await stripeRequest<{ url?: string }>(required(input.runtime.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"), "/v1/billing_portal/sessions", { customer: input.customerId, return_url: input.returnUrl });
  if (!session.url) throw new Error("Stripe did not return a billing portal URL.");
  return session.url;
}

export async function verifyStripeWebhook(payload: string, signature: string | null, secret: string | undefined): Promise<Record<string, unknown>> {
  const webhookSecret = required(secret, "STRIPE_WEBHOOK_SECRET");
  if (!signature) throw new Error("Missing Stripe signature.");
  const parts = signature.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Expired or malformed Stripe signature.");
  const expected = await hmacHex(webhookSecret, `${timestamp}.${payload}`);
  if (!signatures.some((candidate) => timingSafeEqual(candidate, expected))) throw new Error("Invalid Stripe signature.");
  return JSON.parse(payload) as Record<string, unknown>;
}

export async function applyStripeEvent(db: Db, event: Record<string, unknown>): Promise<void> {
  const type = String(event.type || "");
  const data = event.data as { object?: Record<string, unknown> } | undefined;
  const object = data?.object;
  if (!object) return;
  if (type === "checkout.session.completed") {
    const metadata = object.metadata as Record<string, string> | undefined;
    const organizationId = metadata?.organization_id;
    if (!organizationId) return;
    await db.update(organizations).set({
      stripeCustomerId: String(object.customer || "") || null,
      stripeSubscriptionId: String(object.subscription || "") || null,
      planKey: validPlan(metadata?.plan_key),
      subscriptionStatus: "active",
      updatedAt: Date.now(),
    }).where(eq(organizations.id, organizationId));
    return;
  }
  if (type.startsWith("customer.subscription.")) {
    const metadata = object.metadata as Record<string, string> | undefined;
    const organizationId = metadata?.organization_id;
    if (!organizationId) return;
    const status = normalizeStatus(String(object.status || "incomplete"));
    await db.update(organizations).set({
      stripeCustomerId: String(object.customer || "") || null,
      stripeSubscriptionId: String(object.id || "") || null,
      planKey: status === "canceled" ? "trial" : validPlan(metadata?.plan_key),
      subscriptionStatus: status,
      currentPeriodEnd: Number(object.current_period_end || 0) * 1000 || null,
      updatedAt: Date.now(),
    }).where(eq(organizations.id, organizationId));
  }
}

async function stripeRequest<T>(secret: string, path: string, values: Record<string, string>): Promise<T> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe request failed (${response.status}).`);
  return payload;
}

function priceFor(runtime: RuntimeEnv, plan: Exclude<PlanKey, "trial">): string {
  if (plan === "starter") return required(runtime.STRIPE_PRICE_STARTER, "STRIPE_PRICE_STARTER");
  if (plan === "growth") return required(runtime.STRIPE_PRICE_GROWTH, "STRIPE_PRICE_GROWTH");
  return required(runtime.STRIPE_PRICE_PRO, "STRIPE_PRICE_PRO");
}

function validPlan(value: string | undefined): "starter" | "growth" | "pro" {
  return value === "growth" || value === "pro" ? value : "starter";
}

function normalizeStatus(value: string): "trialing" | "active" | "past_due" | "canceled" | "incomplete" {
  if (value === "trialing" || value === "active" || value === "past_due" || value === "canceled") return value;
  return "incomplete";
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}
