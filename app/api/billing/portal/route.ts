import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { verifySameOrigin } from "@/lib/security";
import { createBillingPortal } from "@/lib/stripe";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "billing:manage")) return permissionDenied("billing:manage");
  try {
    const db = getDb();
    const [organization] = await db.select({ customerId: organizations.stripeCustomerId }).from(organizations).where(eq(organizations.id, auth.organizationId)).limit(1);
    if (!organization?.customerId) throw new Error("This workspace does not have a Stripe customer yet.");
    const url = await createBillingPortal({ runtime: getRuntimeEnv(), customerId: organization.customerId, returnUrl: `${normalizedBaseUrl(getRuntimeEnv(), request)}/?section=billing` });
    return Response.json({ url });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
