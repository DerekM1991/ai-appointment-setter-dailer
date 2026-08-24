export const MAX_DNC_AGE_DAYS = 31;
export const MAX_CONCURRENT_CALLS = 20;
export const CALL_WINDOW_START_MINUTES = 9 * 60;
export const CALL_WINDOW_END_MINUTES = 16 * 60 + 30;

export type ComplianceLead = {
  phoneE164: string;
  timezone: string | null;
  consentStatus: string;
  consentCapturedAt: number | null;
  consentSource: string | null;
  consentEvidence: string | null;
  dncCheckedAt: number | null;
  internalDnc: boolean;
};

export type ComplianceResult = {
  eligible: boolean;
  reasons: string[];
};

export function normalizePhoneE164(
  value: unknown,
  defaultCountry = "US",
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const digits = raw.replace(/\D/g, "");
  if (defaultCountry === "US" || defaultCountry === "CA") {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  }
  return null;
}

export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function evaluateLeadCompliance(
  lead: ComplianceLead,
  now = new Date(),
): ComplianceResult {
  const reasons: string[] = [];
  if (!normalizePhoneE164(lead.phoneE164)) reasons.push("invalid_phone");
  if (lead.internalDnc) reasons.push("internal_do_not_call");
  if (lead.consentStatus !== "express_written") {
    reasons.push("express_written_consent_missing");
  }
  if (!lead.consentCapturedAt) reasons.push("consent_timestamp_missing");
  if (!lead.consentSource?.trim()) reasons.push("consent_source_missing");
  if (!lead.consentEvidence?.trim()) reasons.push("consent_evidence_missing");
  if (
    lead.consentCapturedAt &&
    lead.consentCapturedAt > now.getTime() + 5 * 60 * 1000
  ) {
    reasons.push("consent_timestamp_in_future");
  }
  if (!lead.dncCheckedAt) {
    reasons.push("dnc_check_missing");
  } else if (
    now.getTime() - lead.dncCheckedAt > MAX_DNC_AGE_DAYS * 86_400_000
  ) {
    reasons.push("dnc_check_stale");
  } else if (lead.dncCheckedAt > now.getTime() + 5 * 60 * 1000) {
    reasons.push("dnc_check_in_future");
  }
  if (!lead.timezone?.trim() || !isValidTimeZone(lead.timezone)) {
    reasons.push("timezone_missing_or_invalid");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function isWithinCallingWindow(
  timezone: string,
  at = new Date(),
): boolean {
  if (!isValidTimeZone(timezone)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (value.weekday === "Sat" || value.weekday === "Sun") return false;
  const minutes = Number(value.hour) * 60 + Number(value.minute);
  return minutes >= CALL_WINDOW_START_MINUTES && minutes < CALL_WINDOW_END_MINUTES;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function detectsOptOut(utterance: string): boolean {
  return /\b(do not call|don't call|dont call|stop calling|remove me|take me off|opt(?:\s|-)?out|no more calls|never call)\b/i.test(
    utterance,
  );
}

export function isExplicitBookingConfirmation(utterance: string): boolean {
  return /\b(yes|correct|confirmed?|book it|schedule it|that works|works for me|sounds good|let's do|lets do|go ahead)\b/i.test(
    utterance,
  );
}
