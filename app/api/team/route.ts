import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { getAuthorizedApiUser, errorResponse } from "@/lib/api-auth";
import { verifySameOrigin } from "@/lib/security";
import { hasPermission, permissionDenied, type Role } from "@/lib/tenant";

export async function GET() {
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  const rows = await getDb().select({ userId: users.id, email: users.email, displayName: users.displayName, role: memberships.role, status: memberships.status, createdAt: memberships.createdAt }).from(memberships).innerJoin(users, eq(memberships.userId, users.id)).where(eq(memberships.organizationId, auth.organizationId));
  return Response.json({ members: rows });
}

export async function POST(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  try {
    const payload = (await request.json()) as { email?: string; role?: Role };
    const email = payload.email?.trim().toLowerCase(); const role = payload.role;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (!role || !["admin", "manager", "member", "viewer"].includes(role)) throw new Error("Choose a valid non-owner role.");
    const db = getDb(); const [memberCount] = await db.select({ value: count() }).from(memberships).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.status, "active")));
    if (Number(memberCount?.value ?? 0) >= auth.plan.seats) throw new Error(`${auth.plan.name} supports ${auth.plan.seats} active seat${auth.plan.seats === 1 ? "" : "s"}. Upgrade before adding another member.`);
    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1); const now = Date.now();
    if (!user) { const id = crypto.randomUUID(); await db.insert(users).values({ id, email, displayName: email.split("@")[0], status: "active", lastSeenAt: 0, createdAt: now, updatedAt: now }); [user] = await db.select().from(users).where(eq(users.id, id)).limit(1); }
    if (!user) throw new Error("Could not create the member record.");
    await db.insert(memberships).values({ organizationId: auth.organizationId, userId: user.id, role, status: "active", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [memberships.organizationId, memberships.userId], set: { role, status: "active", updatedAt: now } });
    return Response.json({ added: true }, { status: 201 });
  } catch (error) { return errorResponse(error, 400); }
}

export async function PATCH(request: Request) {
  const originError = verifySameOrigin(request); if (originError) return originError;
  const auth = await getAuthorizedApiUser(); if (!auth.ok) return auth.response;
  if (!hasPermission(auth, "members:manage")) return permissionDenied("members:manage");
  try {
    const payload = (await request.json()) as { userId?: string; role?: Role; status?: "active" | "disabled" };
    if (!payload.userId || payload.userId === auth.userId) throw new Error("You cannot change your own membership here.");
    if (payload.role === "owner") throw new Error("Ownership transfer requires a dedicated transfer flow.");
    const updates: { role?: Role; status?: "active" | "disabled"; updatedAt: number } = { updatedAt: Date.now() };
    if (payload.role && ["admin", "manager", "member", "viewer"].includes(payload.role)) updates.role = payload.role;
    if (payload.status && ["active", "disabled"].includes(payload.status)) updates.status = payload.status;
    await getDb().update(memberships).set(updates).where(and(eq(memberships.organizationId, auth.organizationId), eq(memberships.userId, payload.userId)));
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error, 400); }
}
