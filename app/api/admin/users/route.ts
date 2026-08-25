import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { verifySameOrigin } from "@/lib/security";

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  const rows = await getDb().select({ id: users.id, email: users.email, displayName: users.displayName, platformRole: users.platformRole, status: users.status, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt, organizationId: memberships.organizationId, organizationName: organizations.name, workspaceRole: memberships.role, membershipStatus: memberships.status }).from(users).leftJoin(memberships, eq(users.id, memberships.userId)).leftJoin(organizations, eq(memberships.organizationId, organizations.id)).orderBy(desc(users.lastSeenAt));
  return Response.json({ users: rows });
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (auth.platformRole !== "super_admin") return Response.json({ error: "Platform administrator access required." }, { status: 403 });
  try {
    const payload = (await request.json()) as { userId?: string; organizationId?: string; status?: "active" | "suspended"; platformRole?: "user" | "super_admin"; workspaceRole?: "owner" | "admin" | "manager" | "member" | "viewer"; membershipStatus?: "active" | "invited" | "disabled" };
    if (!payload.userId) throw new Error("Choose a user.");
    if (payload.userId === auth.userId && (payload.status === "suspended" || payload.platformRole === "user")) throw new Error("You cannot suspend or demote your own platform account.");
    const updates: Partial<typeof users.$inferInsert> & { updatedAt: number } = { updatedAt: Date.now() };
    if (payload.status && ["active", "suspended"].includes(payload.status)) updates.status = payload.status;
    if (payload.platformRole && ["user", "super_admin"].includes(payload.platformRole)) updates.platformRole = payload.platformRole;
    const db = getDb();
    if (Object.keys(updates).length > 1) await db.update(users).set(updates).where(eq(users.id, payload.userId));
    if (payload.organizationId && (payload.workspaceRole || payload.membershipStatus)) {
      const membershipUpdates: Partial<typeof memberships.$inferInsert> & { updatedAt: number } = { updatedAt: Date.now() };
      if (payload.workspaceRole && ["owner", "admin", "manager", "member", "viewer"].includes(payload.workspaceRole)) {
        if (payload.workspaceRole === "owner") await db.update(memberships).set({ role: "admin", updatedAt: Date.now() }).where(and(eq(memberships.organizationId, payload.organizationId), eq(memberships.role, "owner")));
        membershipUpdates.role = payload.workspaceRole;
      }
      if (payload.membershipStatus && ["active", "invited", "disabled"].includes(payload.membershipStatus)) membershipUpdates.status = payload.membershipStatus;
      await db.update(memberships).set(membershipUpdates).where(and(eq(memberships.organizationId, payload.organizationId), eq(memberships.userId, payload.userId)));
    }
    await writeAuditEvent(db, { organizationId: payload.organizationId || auth.organizationId, actor: auth.email, eventType: "platform_user_updated", entityType: "user", entityId: payload.userId, details: { ...updates, workspaceRole: payload.workspaceRole, membershipStatus: payload.membershipStatus } });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
