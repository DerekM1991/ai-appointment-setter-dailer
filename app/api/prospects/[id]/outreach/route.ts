import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, prospectOutreachEvents } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied } from "@/lib/tenant";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  const { id } = await context.params; const db = getDb();
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, auth.organizationId))).limit(1);
  if (!lead) return Response.json({ error: "Prospect not found." }, { status: 404 });
  const events = await db.select().from(prospectOutreachEvents).where(and(eq(prospectOutreachEvents.organizationId, auth.organizationId), eq(prospectOutreachEvents.leadId, id))).orderBy(desc(prospectOutreachEvents.occurredAt)).limit(100);
  return Response.json({ events });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "prospects:write")) return permissionDenied("prospects:write");
  try {
    const { id } = await context.params; const payload = (await request.json()) as { channel?: "phone" | "email" | "sms" | "manual"; outcome?: string; notes?: string; occurredAt?: number };
    const db = getDb(); const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, auth.organizationId))).limit(1); if (!lead) throw new Error("Prospect not found.");
    const now = Date.now(); await db.insert(prospectOutreachEvents).values({ id: crypto.randomUUID(), organizationId: auth.organizationId, leadId: id, channel: payload.channel && ["phone", "email", "sms", "manual"].includes(payload.channel) ? payload.channel : "manual", status: "completed", outcome: payload.outcome?.trim().slice(0, 100) || "manual_note", notes: payload.notes?.trim().slice(0, 1000) || null, actor: auth.email, occurredAt: Number(payload.occurredAt) || now, createdAt: now, updatedAt: now });
    return Response.json({ added: true }, { status: 201 });
  } catch (error) { return errorResponse(error, 400); }
}
