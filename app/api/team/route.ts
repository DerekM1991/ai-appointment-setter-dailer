import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied, type Role } from "@/lib/tenant";

const ROLE_LEVEL: Record<Role, number> = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  const rows = await getDb().select({ userId: users.id, email: users.email, displayName: users.displayName, role: memberships.role, status: memberships.status, createdAt: memberships.createdAt }).from(memberships).innerJoin(users, eq(memberships.userId, users.id)).where(eq(memberships.organizationId, auth.organizationId));
  return Response.json({ members: rows, manageableRoles: assignableRoles(auth.role) });
}

export async function POST(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  try {
    const payload = (await request.json()) as { email?: string; role?: Role };
    const email = payload.email?.trim().toLowerCase(); const role = payload.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!role || !assignableRoles(auth.role).includes(role)) throw new Error("You cannot assign that role.");
    const db = getDb(); await enforceSeatLimit(db, auth.organizationId, auth.plan.seats);
    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1); const now = Date.now();
    if (!user) { const id = crypto.randomUUID(); await db.insert(users).values({ id, email, displayName: email.split("@")[0], platformRole: "user", status: "active", lastSeenAt: 0, createdAt: now, updatedAt: now }); [user] = await db.select().from(users).where(eq(users.id, id)).limit(1); }
    if (!user) throw new Error("Could not create the member record.");
    await db.insert(memberships).values({ organizationId: auth.organizationId, userId: user.id, role, status: "active", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { role, status: "active", updatedAt: now } });
    await writeAuditEvent(db, { organizationId: auth.organizationId, actor: auth.email, eventType: "team_member_added", entityType: "user", entityId: user.id, details: { email, role } });
    return Response.json({ added: true }, { status: 201 });
  } catch (error) { return errorResponse(error, 400); }
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  try {
    const payload = (await request.json()) as { userId?: string; role?: Role; status?: "active" | "disabled"; transferOwnership?: boolean };
    if (!payload.userId) throw new Error("Choose a team member.");
    const db = getDb(); const [target] = await db.select().from(memberships).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, payload.userId))).limit(1);
    if (!target) throw new Error("Team member not found.");
    if (payload.transferOwnership) {
      if (auth.role !== "owner" || payload.userId === auth.userId) throw new Error("Only the owner can transfer ownership to another member.");
      await db.update(memberships).set({ role: "admin", updatedAt: Date.now() }).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, auth.userId)));
      await db.update(memberships).set({ role: "owner", status: "active", updatedAt: Date.now() }).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, payload.userId)));
      await writeAuditEvent(db, { organizationId: auth.organizationId, actor: auth.email, eventType: "workspace_ownership_transferred", entityType: "user", entityId: payload.userId });
      return Response.json({ updated: true, ownershipTransferred: true });
    }
    if (payload.userId === auth.userId) throw new Error("You cannot change your own role or access.");
    assertCanManage(auth.role, target.role as Role);
    const updates: { role?: Role; status?: "active" | "disabled"; updatedAt: number } = { updatedAt: Date.now() };
    if (payload.role) { if (!assignableRoles(auth.role).includes(payload.role)) throw new Error("You cannot assign that role."); updates.role = payload.role; }
    if (payload.status) { if (payload.status === "active" && target.status !== "active") await enforceSeatLimit(db, auth.organizationId, auth.plan.seats); updates.status = payload.status; }
    await db.update(memberships).set(updates).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, payload.userId)));
    await writeAuditEvent(db, { organizationId: auth.organizationId, actor: auth.email, eventType: "team_member_updated", entityType: "user", entityId: payload.userId, details: updates });
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}

export async function DELETE(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  try {
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId || userId === auth.userId) throw new Error("You cannot remove yourself.");
    const db = getDb(); const [target] = await db.select().from(memberships).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, userId))).limit(1);
    if (!target) throw new Error("Team member not found.");
    assertCanManage(auth.role, target.role as Role);
    await db.delete(memberships).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, userId)));
    await writeAuditEvent(db, { organizationId: auth.organizationId, actor: auth.email, eventType: "team_member_removed", entityType: "user", entityId: userId });
    return Response.json({ deleted: true });
  } catch (error) { return errorResponse(error, 400); }
}

function assignableRoles(actor: Role): Role[] { if (actor === "owner") return ["admin", "manager", "member", "viewer"]; if (actor === "admin") return ["manager", "member", "viewer"]; if (actor === "manager") return ["member", "viewer"]; return []; }
function assertCanManage(actor: Role, target: Role) { if (target === "owner" || ROLE_LEVEL[actor] <= ROLE_LEVEL[target]) throw new Error("You cannot manage a member with an equal or higher role."); }
async function enforceSeatLimit(db: ReturnType<typeof getDb>, organizationId: string, seats: number) { const [row] = await db.select({ value: count() }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active"))); if (Number(row?.value ?? 0) >= seats) throw new Error(`This plan supports ${seats} active seat${seats === 1 ? "" : "s"}. Upgrade before adding or reactivating a member.`); }
