import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, memberships, organizations } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { verifySameOrigin } from "@/lib/security";

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  const db = getDb();
  const rows = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status, planKey: organizations.planKey, subscriptionStatus: organizations.subscriptionStatus, trialEndsAt: organizations.trialEndsAt, createdAt: organizations.createdAt }).from(organizations).orderBy(desc(organizations.createdAt));
  const workspaces = await Promise.all(rows.map(async (workspace) => { const [[members], [callCount]] = await Promise.all([db.select({ value: count() }).from(memberships).where(eq(memberships.organizationId, workspace.id)), db.select({ value: count() }).from(calls).where(eq(calls.organizationId, workspace.id))]); return { ...workspace, memberCount: Number(members?.value ?? 0), callCount: Number(callCount?.value ?? 0) }; }));
  return Response.json({ workspaces });
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  try {
    const payload = (await request.json()) as { organizationId?: string; name?: string; status?: "active" | "suspended"; planKey?: "trial" | "starter" | "growth" | "pro"; subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "incomplete" };
    if (!payload.organizationId) throw new Error("Choose a workspace.");
    const updates: { name?: string; status?: "active" | "suspended"; planKey?: "trial" | "starter" | "growth" | "pro"; subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "incomplete"; updatedAt: number } = { updatedAt: Date.now() };
    if (payload.name?.trim()) updates.name = payload.name.trim().slice(0, 120);
    if (payload.status && ["active", "suspended"].includes(payload.status)) updates.status = payload.status;
    if (payload.planKey && ["trial", "starter", "growth", "pro"].includes(payload.planKey)) updates.planKey = payload.planKey;
    if (payload.subscriptionStatus && ["trialing", "active", "past_due", "canceled", "incomplete"].includes(payload.subscriptionStatus)) updates.subscriptionStatus = payload.subscriptionStatus;
    const db = getDb(); await db.update(organizations).set(updates).where(eq(organizations.id, payload.organizationId));
    await writeAuditEvent(db, { organizationId: payload.organizationId, actor: auth.email, eventType: "platform_workspace_updated", entityType: "organization", entityId: payload.organizationId, details: updates });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
