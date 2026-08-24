import assert from "node:assert/strict";
import test from "node:test";
import {
  detectsOptOut,
  evaluateLeadCompliance,
  isWithinCallingWindow,
  normalizePhoneE164,
} from "../lib/compliance.ts";

test("normalizes North American numbers and rejects malformed values", () => {
  assert.equal(normalizePhoneE164("(312) 555-0199"), "+13125550199");
  assert.equal(normalizePhoneE164("1 312 555 0199"), "+13125550199");
  assert.equal(normalizePhoneE164("123"), null);
});

test("requires complete consent and current DNC evidence", () => {
  const now = new Date("2026-08-24T15:00:00.000Z");
  const valid = {
    phoneE164: "+13125550199",
    timezone: "America/Chicago",
    consentStatus: "express_written",
    consentCapturedAt: Date.parse("2026-08-01T12:00:00.000Z"),
    consentSource: "Website form",
    consentEvidence: "CRM consent record 1042",
    dncCheckedAt: Date.parse("2026-08-20T12:00:00.000Z"),
    internalDnc: false,
  };
  assert.deepEqual(evaluateLeadCompliance(valid, now), { eligible: true, reasons: [] });
  const invalid = evaluateLeadCompliance(
    { ...valid, consentEvidence: null, dncCheckedAt: Date.parse("2026-06-01T12:00:00.000Z") },
    now,
  );
  assert.equal(invalid.eligible, false);
  assert.ok(invalid.reasons.includes("consent_evidence_missing"));
  assert.ok(invalid.reasons.includes("dnc_check_stale"));
});

test("enforces weekday local calling hours", () => {
  assert.equal(
    isWithinCallingWindow("America/Chicago", new Date("2026-08-24T15:00:00.000Z")),
    true,
  );
  assert.equal(
    isWithinCallingWindow("America/Chicago", new Date("2026-08-24T23:00:00.000Z")),
    false,
  );
  assert.equal(
    isWithinCallingWindow("America/Chicago", new Date("2026-08-23T15:00:00.000Z")),
    false,
  );
});

test("detects unambiguous spoken opt-outs", () => {
  assert.equal(detectsOptOut("Please take me off your list and don't call again."), true);
  assert.equal(detectsOptOut("I'm not interested today."), false);
});
