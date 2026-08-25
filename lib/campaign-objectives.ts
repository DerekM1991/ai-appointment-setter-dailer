export const CAMPAIGN_OBJECTIVES = [
  { value: "Book a discovery call", label: "Book a discovery call" },
  { value: "Schedule a product demo", label: "Schedule a product demo" },
  { value: "Schedule a consultation", label: "Schedule a consultation" },
  { value: "Schedule a pricing or quote review", label: "Schedule a pricing or quote review" },
  { value: "Qualify interest and schedule a specialist follow-up", label: "Qualify interest and schedule a specialist follow-up" },
] as const;

export const DEFAULT_CAMPAIGN_OBJECTIVE = CAMPAIGN_OBJECTIVES[0].value;

export function normalizeCampaignObjective(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return CAMPAIGN_OBJECTIVES.some((objective) => objective.value === candidate)
    ? candidate
    : DEFAULT_CAMPAIGN_OBJECTIVE;
}
