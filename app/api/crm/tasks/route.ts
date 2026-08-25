import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTasks, leads } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  const rows = await getDb().select().from(crmTasks).where(eq(crmTasks.organizationId, auth.organizationId)).orderBy(desc(crmTasks.createdAt)).limit(200);
  return Response.json({ tasks: rows });
}

export async function POST(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "prospects:write")) return permissionDenied("prospects:write");
  try {
    const payload = await request.json() as { leadId?: string; title?: string; dueAt?: number | null };
    const title = payload.title?.trim().slice(0, 160); if (!payload.leadId || !title) throw new Error("Prospect and task title are required.");
    const db = getDb(); const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, payload.leadId), eq(leads.organizationId, auth.organizationId))).limit(1); if (!lead) throw new Error("Prospect not found.");
    const now = Date.now(); const task = { id: crypto.randomUUID(), organizationId: auth.organizationId, leadId: lead.id, assignedToUserId: auth.userId, createdByUserId: auth.userId, title, dueAt: payload.dueAt ? Number(payload.dueAt) : null, status: "open" as const, createdAt: now, updatedAt: now };
    await db.insert(crmTasks).values(task); return Response.json({ task }, { status: 201 });
  } catch (error) { return errorResponse(error, 400); }
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "prospects:write")) return permissionDenied("prospects:write");
  try {
    const payload = await request.json() as { id?: string; status?: "open" | "completed" | "cancelled" };
    if (!payload.id || !payload.status || !["open", "completed", "cancelled"].includes(payload.status)) throw new Error("A valid task and status are required.");
    await getDb().update(crmTasks).set({ status: payload.status, updatedAt: Date.now() }).where(and(eq(crmTasks.id, payload.id), eq(crmTasks.organizationId, auth.organizationId)));
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
