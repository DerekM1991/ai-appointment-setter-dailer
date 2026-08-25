import { getDb } from "@/db";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { launchCampaignBatch } from "@/lib/campaign-runner";
import { getRuntimeEnv } from "@/lib/env";
import { verifySameOrigin, enforceRateLimit } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  if (!hasPermission(auth, "calls:launch")) return permissionDenied("calls:launch");
  if ((auth.subscriptionStatus === "past_due" || auth.subscriptionStatus === "canceled") || (auth.planKey === "trial" && auth.trialEndsAt && auth.trialEndsAt < Date.now())) return Response.json({ error: "An active subscription is required to launch calls." }, { status: 402 });
  try {
    const db = getDb();
    const rateError = await enforceRateLimit({ db, key: `launch:${auth.organizationId}:${auth.userId}`, limit: 10, windowMs: 60_000 });
    if (rateError) return rateError;
    const payload = (await request.json()) as { complianceAttested?: boolean };
    if (payload.complianceAttested !== true) {
      return Response.json(
        { error: "Confirm the consent and DNC attestation before launch." },
        { status: 400 },
      );
    }
    const { id } = await context.params;
    const result = await launchCampaignBatch({
      db,
      runtime: getRuntimeEnv(),
      campaignId: id,
      actor: auth.email,
      request,
      organizationId: auth.organizationId,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, 400);
  }
}
