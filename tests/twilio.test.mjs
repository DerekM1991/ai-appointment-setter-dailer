import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { validateTwilioRequest } from "../lib/twilio.ts";

test("validates Twilio HMAC signatures including sorted POST parameters", async () => {
  const token = "test-auth-token";
  const url = "https://example.com/api/twilio/status?callId=abc";
  const params = new URLSearchParams([
    ["CallStatus", "completed"],
    ["CallSid", "CA123"],
  ]);
  const material = `${url}CallSidCA123CallStatuscompleted`;
  const signature = createHmac("sha1", token).update(material).digest("base64");
  const request = new Request(url, { headers: { "x-twilio-signature": signature } });
  assert.equal(await validateTwilioRequest(request, token, params), true);
  assert.equal(await validateTwilioRequest(request, "wrong-token", params), false);
});
