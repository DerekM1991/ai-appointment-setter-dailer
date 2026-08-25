import { getDb } from "@/db";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { verifySameOrigin } from "@/lib/security";
import { createSubscriptionCheckout } from "@/lib/stripe";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "billing:manage")) return permissionDenied("billing:manage");
  try {
    const payload = (await request.json()) as { plan?: string };
    if (payload.plan !== "starter" && payload.plan !== "growth" && payload.plan !== "pro") throw new Error("Choose a valid subscription plan.");
    const baseUrl = normalizedBaseUrl(getRuntimeEnv(), request);
    const url = await createSubscriptionCheckout({ db: getDb(), runtime: getRuntimeEnv(), organizationId: auth.organizationId, organizationName: auth.organizationName, email: auth.email, plan: payload.plan, returnUrl: `${baseUrl}/?section=billing` });
    return Response.json({ url });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
