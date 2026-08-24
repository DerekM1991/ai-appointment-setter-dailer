import { getDb } from "@/db";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { launchCampaignBatch } from "@/lib/campaign-runner";
import { getRuntimeEnv } from "@/lib/env";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const payload = (await request.json()) as { complianceAttested?: boolean };
    if (payload.complianceAttested !== true) {
      return Response.json(
        { error: "Confirm the consent and DNC attestation before launch." },
        { status: 400 },
      );
    }
    const { id } = await context.params;
    const result = await launchCampaignBatch({
      db: getDb(),
      runtime: getRuntimeEnv(),
      campaignId: id,
      actor: auth.email,
      request,
    });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, 400);
  }
}
