import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv, normalizedBaseUrl } from "@/lib/env";
import { buildOutlookAuthorizationUrl } from "@/lib/outlook";

export async function GET(request: Request) {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const runtime = getRuntimeEnv();
    const redirectUri = `${normalizedBaseUrl(runtime, request)}/api/outlook/callback`;
    const url = await buildOutlookAuthorizationUrl({
      runtime,
      redirectUri,
      userEmail: auth.email,
    });
    return Response.redirect(url, 302);
  } catch (error) {
    return errorResponse(error, 400);
  }
}
