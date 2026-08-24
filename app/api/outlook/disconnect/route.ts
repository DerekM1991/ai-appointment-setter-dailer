import { getDb } from "@/db";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { disconnectOutlook } from "@/lib/outlook";

export async function POST() {
  const auth = await getAuthorizedApiUser();
  if (!auth.ok) return auth.response;
  try {
    const db = getDb();
    await disconnectOutlook(db);
    await writeAuditEvent(db, {
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
