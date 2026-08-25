import { getDb } from "@/db";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { disconnectOutlook } from "@/lib/outlook";
import { verifySameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  const originError = verifySameOrigin(request);
  if (originError) return originError;
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const db = getDb();
    await disconnectOutlook(db, auth.organizationId, auth.userId);
    await writeAuditEvent(db, {
      organizationId: auth.organizationId,
      actor: auth.email,
      eventType: "outlook_disconnected",
      entityType: "integration",
      entityId: "microsoft",
    });
    return Response.json({ disconnected: true });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
