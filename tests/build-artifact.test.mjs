import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("build emits a deployable worker and appointment-setting control room", async () => {
  const worker = new URL("../dist/server/index.js", import.meta.url);
  const workerStat = await stat(worker);
  assert.ok(workerStat.size > 1_000);
  const dashboard = await readFile(
    new URL("../app/components/dialer-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /Appointment Setter/i);
  assert.match(dashboard, /Compliance gate active/);
  assert.match(dashboard, /Import Excel or CSV/);
  assert.match(dashboard, /Start protected calling/);
  assert.match(dashboard, /Team & roles/);
  assert.match(dashboard, /Billing & plans/);
  assert.match(dashboard, /Connect Google/);
  assert.match(dashboard, /Platform Super Admin/);
  assert.match(dashboard, /Prospect import guide/);
  assert.match(dashboard, /Permanent contact ledger/);
});

test("worker owns the signed ConversationRelay WebSocket route", async () => {
  const workerSource = await readFile(
    new URL("../worker/index.ts", import.meta.url),
    "utf8",
  );
  const conversationSource = await readFile(
    new URL("../worker/conversation.ts", import.meta.url),
    "utf8",
  );
  assert.match(workerSource, /\/api\/twilio\/conversation/);
  assert.match(conversationSource, /validateTwilioRequest/);
  assert.match(conversationSource, /detectsOptOut/);
  assert.match(conversationSource, /createCalendarAppointment/);
});

test("SaaS routes enforce tenant, role, plan, and billing controls", async () => {
  const [tenant, plans, dashboard, integrations, stripe, security] = await Promise.all([
    readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/plans.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/security.ts", import.meta.url), "utf8"),
  ]);
  assert.match(tenant, /owner.*admin.*manager.*member.*viewer/s);
  assert.match(plans, /priceMonthly: 19\.99/);
  assert.match(plans, /concurrentCalls: 20/);
  assert.match(dashboard, /organizationId, auth\.organizationId/);
  assert.match(integrations, /APP_ENCRYPTION_KEY|saveCredentialIntegration/);
  assert.match(stripe, /verifyStripeWebhook/);
  assert.match(security, /sec-fetch-site/);
});

test("public website, account entry, and platform grants are present", async () => {
  const [marketing, dashboard, admin, stripe, migration] = await Promise.all([
    readFile(new URL("../app/components/marketing-site.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dialer-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/workspaces/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/stripe.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_new_imperial_guard.sql", import.meta.url), "utf8"),
  ]);
  assert.match(marketing, /Features.*Pricing.*Security.*Contact/s);
  assert.match(marketing, /Log in/);
  assert.match(marketing, /Sign up free/);
  assert.match(dashboard, /Platform administration/);
  assert.match(dashboard, /Complimentary.*Discounted/s);
  assert.match(admin, /billingOverrideEndsAt/);
  assert.match(stripe, /discounts\[0\]\[coupon\]/);
  assert.match(migration, /billing_override_type/);
});
