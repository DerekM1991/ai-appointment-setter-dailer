import { getDb } from "@/db";
import { getRuntimeEnv } from "@/lib/env";
import { applyStripeEvent, verifyStripeWebhook } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const event = await verifyStripeWebhook(payload, request.headers.get("stripe-signature"), getRuntimeEnv().STRIPE_WEBHOOK_SECRET);
    await applyStripeEvent(getDb(), event);
    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Webhook rejected." }, { status: 400 });
  }
}
