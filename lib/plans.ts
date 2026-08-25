export type PlanKey = "trial" | "starter" | "growth" | "pro";

export type PlanDefinition = {
  key: PlanKey;
  name: string;
  priceMonthly: number;
  seats: number;
  prospects: number;
  campaigns: number;
  concurrentCalls: number;
  callsPerMonth: number;
  workspaceIntegrations: number;
  auditRetentionDays: number;
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  trial: {
    key: "trial",
    name: "14-day trial",
    priceMonthly: 0,
    seats: 1,
    prospects: 100,
    campaigns: 1,
    concurrentCalls: 1,
    callsPerMonth: 10,
    workspaceIntegrations: 2,
    auditRetentionDays: 7,
  },
  starter: {
    key: "starter",
    name: "Starter",
    priceMonthly: 49,
    seats: 1,
    prospects: 1_000,
    campaigns: 3,
    concurrentCalls: 2,
    callsPerMonth: 250,
    workspaceIntegrations: 3,
    auditRetentionDays: 30,
  },
  growth: {
    key: "growth",
    name: "Growth",
    priceMonthly: 149,
    seats: 5,
    prospects: 5_000,
    campaigns: 20,
    concurrentCalls: 10,
    callsPerMonth: 2_000,
    workspaceIntegrations: 10,
    auditRetentionDays: 180,
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceMonthly: 399,
    seats: 20,
    prospects: 25_000,
    campaigns: 100,
    concurrentCalls: 20,
    callsPerMonth: 10_000,
    workspaceIntegrations: 50,
    auditRetentionDays: 365,
  },
};

export function planFor(value: string | null | undefined): PlanDefinition {
  return PLANS[(value && value in PLANS ? value : "trial") as PlanKey];
}

export function monthlyPeriodKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
