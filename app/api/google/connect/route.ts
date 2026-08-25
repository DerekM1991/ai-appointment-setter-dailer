import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { buildGoogleAuthorizationUrl } from "@/lib/google-calendar";

export async function GET(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const runtime = getRuntimeEnv();
    const redirectUri = `${normalizedBaseUrl(runtime, request)}/api/google/callback`;
    return Response.redirect(await buildGoogleAuthorizationUrl({ runtime, redirectUri, userEmail: auth.email, userId: auth.userId, organizationId: auth.organizationId }), 302);
  } catch (error) { return errorResponse(error, 400); }
}
