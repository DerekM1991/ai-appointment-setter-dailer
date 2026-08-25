import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrationConnections } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { getRuntimeEnv } from "@/lib/env";
import { deleteIntegration, listVisibleIntegrations, saveCredentialIntegration } from "@/lib/integrations";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function GET() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  return Response.json({ connections: await listVisibleIntegrations(getDb(), auth.organizationId, auth.userId) });
}

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const payload = (await request.json()) as { provider?: string; scope?: string; label?: string; config?: Record<string, string> };
    if (payload.provider !== "twilio" && payload.provider !== "openai" && payload.provider !== "calcom") throw new Error("Choose a supported provider.");
    const scope = payload.provider === "calcom" && payload.scope === "personal" ? "personal" : "workspace";
    if (scope === "workspace" && !hasPermission(auth, "integrations:workspace")) return permissionDenied("integrations:workspace");
    if (scope === "personal" && !hasPermission(auth, "integrations:personal")) return permissionDenied("integrations:personal");
    const db = getDb();
    const [existing] = await db.select({ value: count() }).from(integrationConnections).where(eq(integrationConnections.organizationId, auth.organizationId));
    if (Number(existing?.value ?? 0) >= auth.plan.workspaceIntegrations) throw new Error(`${auth.plan.name} supports ${auth.plan.workspaceIntegrations} saved integrations.`);
    const id = await saveCredentialIntegration({ db, runtime: getRuntimeEnv(), organizationId: auth.organizationId, userId: auth.userId, provider: payload.provider, scope, label: payload.label?.trim() || payload.provider, config: payload.config ?? {} });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function DELETE(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Integration ID is required.");
    const deleted = await deleteIntegration(getDb(), auth.organizationId, id, auth.userId, hasPermission(auth, "integrations:workspace"));
    if (!deleted) return Response.json({ error: "Integration not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
