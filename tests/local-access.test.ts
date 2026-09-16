import test from "node:test";
import assert from "node:assert/strict";
import { appOrigin, assertLocalRequest, assertSameOrigin } from "../lib/local-access";

function request(headers: Record<string, string> = {}) {
  const origin = appOrigin();
  return new Request(`${origin.origin}/api/workspace`, { headers: { host: origin.host, ...headers } });
}

test("local reads reject remote Host, foreign Origin, and cross-site fetches", () => {
  assert.doesNotThrow(() => assertLocalRequest(request()));
  assert.throws(() => assertLocalRequest(request({ host: "attacker.example" })), /localhost/);
  assert.throws(() => assertLocalRequest(request({ host: "attacker.example", "x-forwarded-host": appOrigin().host })), /localhost/);
  assert.throws(() => assertLocalRequest(request({ origin: "https://attacker.example" })), /local workspace/);
  assert.throws(() => assertLocalRequest(request({ "sec-fetch-site": "cross-site" })), /localhost/);
});

test("writes require the exact local origin and custom client header", () => {
  assert.doesNotThrow(() => assertSameOrigin(request({ origin: appOrigin().origin, "x-pathways-client": "1" })));
  assert.throws(() => assertSameOrigin(request()), /local workspace/);
  assert.throws(() => assertSameOrigin(request({ origin: appOrigin().origin })), /local workspace/);
  assert.throws(() => assertSameOrigin(request({ origin: "null", "x-pathways-client": "1" })), /local workspace/);
});

test("configuration cannot silently turn this edition into a public server", () => {
  const before = process.env.APP_BASE_URL;
  try {
    process.env.APP_BASE_URL = "https://public.example";
    assert.throws(appOrigin, /localhost URL/);
  } finally {
    if (before === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = before;
  }
});
