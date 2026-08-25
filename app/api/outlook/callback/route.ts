import { getDb } from "@/db";
import { getAuthorizedApiUser } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { completeOutlookAuthorization } from "@/lib/outlook";

export async function GET(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const runtime = getRuntimeEnv();
  const baseUrl = normalizedBaseUrl(runtime, request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  try {
    if (providerError) throw new Error(providerError);
    if (!code || !state) throw new Error("Microsoft returned an incomplete authorization response.");
    const db = getDb();
    const connected = await completeOutlookAuthorization({
      db,
      runtime,
      code,
      state,
      redirectUri: `${baseUrl}/api/outlook/callback`,
      userEmail: auth.email,
      userId: auth.userId,
      organizationId: auth.organizationId,
    });
    await writeAuditEvent(db, {
      organizationId: auth.organizationId,
      actor: auth.email,
      eventType: "outlook_connected",
      entityType: "integration",
      entityId: "microsoft",
      details: { accountEmail: connected.accountEmail },
    });
    return Response.redirect(`${baseUrl}/?outlook=connected`, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.redirect(
      `${baseUrl}/?outlook_error=${encodeURIComponent(message.slice(0, 180))}`,
      302,
    );
  }
}
