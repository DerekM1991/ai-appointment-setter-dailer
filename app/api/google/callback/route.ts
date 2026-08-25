import { getDb } from "@/db";
import { getAuthorizedApiUser } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { completeGoogleAuthorization } from "@/lib/google-calendar";

export async function GET(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  const runtime = getRuntimeEnv();
  const baseUrl = normalizedBaseUrl(runtime, request);
  const url = new URL(request.url);
  try {
    const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (providerError) throw new Error(providerError);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Google returned an incomplete authorization response.");
    const db = getDb();
    const connected = await completeGoogleAuthorization({ db, runtime, code, state, redirectUri: `${baseUrl}/api/google/callback`, userEmail: auth.email, userId: auth.userId, organizationId: auth.organizationId });
    await writeAuditEvent(db, { organizationId: auth.organizationId, actor: auth.email, eventType: "google_calendar_connected", entityType: "integration", entityId: "google", details: { accountEmail: connected.accountEmail } });
    return Response.redirect(`${baseUrl}/app?google=connected`, 302);
  } catch (error) { return Response.redirect(`${baseUrl}/app?google_error=${encodeURIComponent((error instanceof Error ? error.message : String(error)).slice(0, 180))}`, 302); }
}
