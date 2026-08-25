import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, leads } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

const STAGES = ["new", "attempted", "connected", "qualified", "appointment_set", "nurturing", "won", "lost", "do_not_contact"] as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "prospects:write")) return permissionDenied("prospects:write");
  try {
    const { id } = await context.params;
    const payload = await request.json() as { crmStage?: string; nextFollowUpAt?: number | null; notes?: string };
    const db = getDb();
    const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, auth.organizationId))).limit(1);
    if (!lead) return Response.json({ error: "Prospect not found." }, { status: 404 });
    const stage = payload.crmStage && STAGES.includes(payload.crmStage as typeof STAGES[number]) ? payload.crmStage as typeof STAGES[number] : undefined;
    if (payload.crmStage && !stage) return Response.json({ error: "Invalid CRM stage." }, { status: 400 });
    const now = Date.now();
    await db.update(leads).set({ ...(stage ? { crmStage: stage } : {}), ...(payload.nextFollowUpAt !== undefined ? { nextFollowUpAt: payload.nextFollowUpAt ? Number(payload.nextFollowUpAt) : null } : {}), ...(payload.notes !== undefined ? { notes: payload.notes.trim().slice(0, 2000) || null } : {}), ...(stage === "do_not_contact" ? { internalDnc: true } : {}), updatedAt: now }).where(and(eq(leads.id, id), eq(leads.organizationId, auth.organizationId)));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: auth.organizationId, actor: auth.email, eventType: "crm.prospect.updated", entityType: "lead", entityId: id, detailsJson: JSON.stringify({ crmStage: stage, nextFollowUpAt: payload.nextFollowUpAt ?? undefined }), createdAt: now });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
