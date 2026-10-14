import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiSettingsPath, publicAiSettings, readAstraKey, saveAstraKey, removeAstraKey } from "../lib/local-ai-settings";

test("user-supplied keys persist with private file permissions and are never returned as settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "pathways-key-test-")), env = { PATHWAYS_DB_PATH: join(directory, "data", "workspace.sqlite") };
  const key = "sk-test-key-which-is-not-a-real-credential";
  try {
    assert.equal(publicAiSettings(env).configured, false);
    saveAstraKey({ apiKey: key }, env);
    assert.equal(readAstraKey(env).apiKey, key);
    assert.equal(statSync(aiSettingsPath(env)).mode & 0o777, 0o600);
    assert.equal(publicAiSettings(env).enabled, true);
    assert.ok(!JSON.stringify(publicAiSettings(env)).includes(key));
    const next = "sk-replaced-test-key-not-a-real-credential";
    saveAstraKey({ apiKey: next }, env);
    assert.equal(readAstraKey(env).apiKey, next);
    assert.ok(!readFileSync(aiSettingsPath(env), "utf8").includes(key));
    assert.throws(() => saveAstraKey({ apiKey: "short" }, env));
    assert.throws(() => saveAstraKey({ apiKey: next + "\nInjected: x" }, env));
    assert.throws(() => saveAstraKey({ apiKey: next, extra: true }, env));
    removeAstraKey(env); removeAstraKey(env);
    assert.equal(publicAiSettings(env).configured, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("environment credentials take precedence without exposing them or requiring a subscription", () => {
  const env = { OPENAI_API_KEY: "sk-environment-test-key-not-real", PATHWAYS_AI_SETTINGS_PATH: join(tmpdir(), `absent-${crypto.randomUUID()}`) };
  assert.equal(readAstraKey(env).source, "environment");
  assert.equal(publicAiSettings(env).enabled, true);
  assert.equal(publicAiSettings({ ...env, PATHWAYS_OPENAI_ENABLED: "false" }).enabled, false);
  assert.ok(!JSON.stringify(publicAiSettings(env)).includes(env.OPENAI_API_KEY));
});
