import {
  evaluateLeadCompliance,
  normalizePhoneE164,
} from "./compliance.ts";

export type WorkbookCell = string | number | boolean | Date | null | undefined;
export type WorkbookRow = WorkbookCell[];

export type ImportedLead = {
  firstName: string;
  lastName: string;
  company: string | null;
  title: string | null;
  phoneE164: string;
  email: string | null;
  timezone: string | null;
  stateRegion: string | null;
  countryCode: string;
  lineType: string | null;
  consentStatus: "express_written" | "revoked" | "unknown";
  consentCapturedAt: number | null;
  consentSource: string | null;
  consentEvidence: string | null;
  dncCheckedAt: number | null;
  internalDnc: boolean;
  notes: string | null;
  complianceReasons: string[];
};

const aliases: Record<string, string[]> = {
  firstName: ["first_name", "firstname", "first", "given_name"],
  lastName: ["last_name", "lastname", "last", "surname", "family_name"],
  company: ["company", "organization", "account", "business"],
  title: ["title", "job_title", "role"],
  phone: ["phone", "phone_number", "mobile", "telephone", "cell"],
  email: ["email", "email_address", "work_email"],
  timezone: ["timezone", "time_zone", "iana_timezone"],
  stateRegion: ["state", "region", "state_region", "province"],
  countryCode: ["country", "country_code"],
  lineType: ["line_type", "phone_type"],
  consentStatus: ["consent_status", "consent", "permission_status"],
  consentCapturedAt: [
    "consent_timestamp",
    "consent_captured_at",
    "consent_date",
  ],
  consentSource: ["consent_source", "permission_source"],
  consentEvidence: [
    "consent_evidence",
    "consent_record",
    "consent_proof",
    "evidence_url",
  ],
  dncCheckedAt: ["dnc_checked_at", "dnc_checked", "dnc_check_date"],
  internalDnc: ["internal_dnc", "do_not_call", "dnc"],
  notes: ["notes", "comments"],
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mapWorkbookRows(rows: WorkbookRow[]): {
  leads: ImportedLead[];
  rejected: Array<{ row: number; reason: string }>;
} {
  if (!rows.length) return { leads: [], rejected: [] };
  const header = rows[0].map(normalizeHeader);
  const indexes = Object.fromEntries(
    Object.entries(aliases).map(([field, candidates]) => [
      field,
      header.findIndex((name) => candidates.includes(name)),
    ]),
  ) as Record<string, number>;

  const leads: ImportedLead[] = [];
  const rejected: Array<{ row: number; reason: string }> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.some((cell) => String(cell ?? "").trim())) continue;
    const get = (field: string): WorkbookCell =>
      indexes[field] >= 0 ? row[indexes[field]] : null;
    const countryCode = asString(get("countryCode"))?.toUpperCase() || "US";
    const phoneE164 = normalizePhoneE164(get("phone"), countryCode);
    if (!phoneE164) {
      rejected.push({ row: index + 1, reason: "Phone is missing or invalid." });
      continue;
    }

    const lead: ImportedLead = {
      firstName: asString(get("firstName")) || "Unknown",
      lastName: asString(get("lastName")) || "Prospect",
      company: asString(get("company")),
      title: asString(get("title")),
      phoneE164,
      email: asString(get("email"))?.toLowerCase() || null,
      timezone: asString(get("timezone")),
      stateRegion: asString(get("stateRegion")),
      countryCode,
      lineType: asString(get("lineType")),
      consentStatus: parseConsentStatus(get("consentStatus")),
      consentCapturedAt: parseDate(get("consentCapturedAt")),
      consentSource: asString(get("consentSource")),
      consentEvidence: asString(get("consentEvidence")),
      dncCheckedAt: parseDate(get("dncCheckedAt")),
      internalDnc: parseBoolean(get("internalDnc")),
      notes: asString(get("notes")),
      complianceReasons: [],
    };
    lead.complianceReasons = evaluateLeadCompliance(lead).reasons;
    leads.push(lead);
  }
  return { leads, rejected };
}

function asString(value: WorkbookCell): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value instanceof Date ? value.toISOString() : String(value).trim();
  return normalized || null;
}

function parseDate(value: WorkbookCell): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value === "number") {
    if (value > 10_000_000_000) return value;
    if (value > 10_000_000) return value * 1000;
  }
  const raw = asString(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseBoolean(value: WorkbookCell): boolean {
  if (typeof value === "boolean") return value;
  return /^(true|yes|y|1|blocked)$/i.test(asString(value) ?? "");
}

function parseConsentStatus(
  value: WorkbookCell,
): ImportedLead["consentStatus"] {
  const normalized = normalizeHeader(value);
  if (
    [
      "express_written",
      "prior_express_written_consent",
      "express_written_consent",
      "pewc",
    ].includes(normalized)
  ) {
    return "express_written";
  }
  if (["revoked", "withdrawn", "opted_out"].includes(normalized)) {
    return "revoked";
  }
  return "unknown";
}
