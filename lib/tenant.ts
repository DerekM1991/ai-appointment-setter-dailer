import { and, count, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getRuntimeEnv } from "./env";
import { planFor, type PlanDefinition, type PlanKey } from "./plans";

type Db = ReturnType<typeof getDb>;
export type Role = "owner" | "admin" | "manager" | "member" | "viewer";
export type Permission =
  | "dashboard:read"
  | "prospects:write"
  | "campaigns:write"
  | "calls:launch"
  | "integrations:personal"
  | "integrations:workspace"
  | "members:manage"
  | "billing:manage"
  | "audit:read";

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(["dashboard:read", "prospects:write", "campaigns:write", "calls:launch", "integrations:personal", "integrations:workspace", "members:manage", "billing:manage", "audit:read"]),
  admin: new Set(["dashboard:read", "prospects:write", "campaigns:write", "calls:launch", "integrations:personal", "integrations:workspace", "members:manage", "audit:read"]),
  manager: new Set(["dashboard:read", "prospects:write", "campaigns:write", "calls:launch", "integrations:personal", "members:manage", "audit:read"]),
  member: new Set(["dashboard:read", "prospects:write", "campaigns:write", "integrations:personal"]),
  viewer: new Set(["dashboard:read"]),
};

export type TenantContext = {
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  platformRole: "user" | "super_admin";
  planKey: PlanKey;
  plan: PlanDefinition;
  subscriptionStatus: string;
  trialEndsAt: number | null;
};

export async function ensureTenantContext(db: Db, identity: ChatGPTUser): Promise<TenantContext> {
  const email = identity.email.trim().toLowerCase();
  const now = Date.now();
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      displayName: identity.displayName.slice(0, 120),
      status: "active",
      platformRole: getRuntimeEnv().APP_OWNER_EMAIL?.trim().toLowerCase() === email ? "super_admin" : "user",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: users.email });
    [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  } else {
    const platformRole = getRuntimeEnv().APP_OWNER_EMAIL?.trim().toLowerCase() === email ? "super_admin" : user.platformRole;
    await db.update(users).set({ displayName: identity.displayName.slice(0, 120), platformRole, lastSeenAt: now, updatedAt: now }).where(eq(users.id, user.id));
    user = { ...user, platformRole };
  }
  if (!user || user.status !== "active") throw new Error("This user account is not active.");

  let [membership] = await db
    .select({
      organizationId: memberships.organizationId,
      role: memberships.role,
      status: memberships.status,
      organizationName: organizations.name,
      planKey: organizations.planKey,
      subscriptionStatus: organizations.subscriptionStatus,
      trialEndsAt: organizations.trialEndsAt,
      organizationStatus: organizations.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
    .limit(1);

  if (!membership) {
    const bootstrapOwner = getRuntimeEnv().APP_OWNER_EMAIL?.trim().toLowerCase() === email;
    const organizationId = bootstrapOwner ? "legacy" : crypto.randomUUID();
    const organizationName = bootstrapOwner ? "AI Appointment Setter" : `${identity.displayName}'s workspace`;
    await db.insert(organizations).values({
      id: organizationId,
      name: organizationName.slice(0, 120),
      slug: `${slugify(identity.displayName)}-${organizationId.slice(0, 8)}`,
      planKey: bootstrapOwner ? "pro" : "trial",
      subscriptionStatus: bootstrapOwner ? "active" : "trialing",
      trialEndsAt: bootstrapOwner ? null : now + 14 * 86_400_000,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    await db.insert(memberships).values({
      organizationId,
      userId: user.id,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    [membership] = await db
      .select({
        organizationId: memberships.organizationId,
        role: memberships.role,
        status: memberships.status,
        organizationName: organizations.name,
        planKey: organizations.planKey,
        subscriptionStatus: organizations.subscriptionStatus,
      trialEndsAt: organizations.trialEndsAt,
      organizationStatus: organizations.status,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
      .limit(1);
  }
  if (!membership) throw new Error("Could not provision a workspace.");
  if (membership.organizationStatus !== "active" && user.platformRole !== "super_admin") throw new Error("This workspace is suspended.");
  return {
    userId: user.id,
    email,
    displayName: identity.displayName,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    role: membership.role as Role,
    platformRole: user.platformRole,
    planKey: membership.planKey as PlanKey,
    plan: planFor(membership.planKey),
    subscriptionStatus: membership.subscriptionStatus,
    trialEndsAt: membership.trialEndsAt,
  };
}

export function hasPermission(context: TenantContext, permission: Permission): boolean {
  return ROLE_PERMISSIONS[context.role].has(permission);
}

export function permissionDenied(permission: Permission): Response {
  return Response.json({ error: `Your role does not include ${permission}.` }, { status: 403 });
}

export async function countWorkspaceMembers(db: Db, organizationId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")));
  return Number(row?.value ?? 0);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
}
