import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("build emits a deployable worker and ODIN control room", async () => {
  const worker = new URL("../dist/server/index.js", import.meta.url);
  const workerStat = await stat(worker);
  assert.ok(workerStat.size > 1_000);
  const dashboard = await readFile(
    new URL("../app/components/dialer-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /ODIN/);
  assert.match(dashboard, /Compliance gate active/);
  assert.match(dashboard, /Import Excel or CSV/);
  assert.match(dashboard, /Start protected calling/);
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
  assert.match(conversationSource, /createOutlookAppointment/);
});
