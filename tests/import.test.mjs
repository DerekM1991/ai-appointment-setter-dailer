import assert from "node:assert/strict";
import test from "node:test";
import { mapWorkbookRows } from "../lib/import.ts";

test("maps workbook aliases without inferring vague consent", () => {
  const { leads, rejected } = mapWorkbookRows([
    [
      "First Name",
      "Last Name",
      "Phone Number",
      "Time Zone",
      "Consent Status",
      "Consent Date",
      "Consent Source",
      "Consent Evidence",
      "DNC Checked",
    ],
    [
      "Ada",
      "Lovelace",
      "312-555-0199",
      "America/Chicago",
      "prior express written consent",
      "2026-08-01",
      "Web form",
      "record-42",
      "2026-08-20",
    ],
    [
      "Grace",
      "Hopper",
      "202-555-0185",
      "America/New_York",
      "yes",
      "2026-08-01",
      "Web form",
      "record-43",
      "2026-08-20",
    ],
  ]);
  assert.equal(rejected.length, 0);
  assert.equal(leads[0].phoneE164, "+13125550199");
  assert.equal(leads[0].consentStatus, "express_written");
  assert.equal(leads[0].complianceReasons.length, 0);
  assert.equal(leads[1].consentStatus, "unknown");
  assert.ok(leads[1].complianceReasons.includes("express_written_consent_missing"));
});

test("rejects rows without a valid phone number", () => {
  const result = mapWorkbookRows([
    ["first", "last", "phone"],
    ["No", "Number", "invalid"],
  ]);
  assert.equal(result.leads.length, 0);
  assert.equal(result.rejected[0].row, 2);
});
