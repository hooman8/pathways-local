import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { saveProjectTemplate, mergeProjectImport, parseProjectImport } from "../lib/projects";
import type { SharedSnapshot } from "../lib/shared";

// An OS-assigned port and a fresh temporary database isolate every run from the
// user's local workspace. These tests never import cloud SDKs or credentials.
test("production app works with only a local SQLite database", { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "pathways-api-test-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = `http://localhost:${port}`;
  const root = process.env.PATHWAYS_TEST_ROOT!;
  let server: ChildProcess | undefined;
  let logs = "";
  const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/workspace`, {
    method, headers: { "Content-Type": "application/json", "X-Pathways-Client": "1", "X-Pathways-Decisions": "1", Origin: origin, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  const snapshot = async () => { const response = await request(); assert.equal(response.status, 200, await response.clone().text()); return await response.json() as SharedSnapshot; };
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const closed = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server?.kill("SIGKILL"), 5000);
    await closed; clearTimeout(timer);
  }
  async function start() {
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: root, env: { ...process.env, NODE_ENV: "production", APP_BASE_URL: origin, PATHWAYS_DB_PATH: join(directory, "workspace.sqlite"), NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout!, server.stderr!]) stream.on("data", chunk => { logs = (logs + chunk).slice(-12000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Startup. */ }
      if (server.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start: ${logs}`);
  }
  try {
    await start();
    let latest = await snapshot();
    await t.test("first visit creates a local owner without login or credentials", async () => {
      assert.equal(latest.membership.role, "owner");
      assert.equal(latest.user.userId, "local-owner");
      assert.ok(latest.workspace!.projects.length);
      const page = await fetch(origin);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("x-frame-options"), "DENY");
      assert.equal(page.headers.get("content-security-policy"), "frame-ancestors 'none'");
      assert.match(await page.text(), /Pathways Local/);
      assert.equal((await fetch(`${origin}/api/session`, { method: "POST" })).status, 404);
      assert.equal((await fetch(`${origin}/api/members`, { method: "PUT" })).status, 404);
    });
    await t.test("cross-site reads/writes and rebinding hosts are rejected", async () => {
      assert.equal((await request("GET", undefined, { Origin: "https://attacker.example" })).status, 403);
      // fetch may normalize Host; use the raw HTTP client for a real rebinding request.
      const rebound = await new Promise<number>(resolve => {
        const req = httpRequest(`${origin}/api/workspace`, { headers: { Host: "attacker.example", "X-Forwarded-Host": new URL(origin).host } }, response => { response.resume(); resolve(response.statusCode!); });
        req.on("error", () => resolve(0)); req.end();
      });
      assert.equal(rebound, 403, "an attacker-controlled Host must be rejected");
      assert.equal((await request("GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
      assert.equal((await request("PUT", { revision: latest.revision, workspace: latest.workspace }, { Origin: "https://attacker.example" })).status, 403);
      assert.equal((await request("PUT", {}, { "X-Pathways-Client": "" })).status, 403);
      assert.equal((await request("PUT", {}, { Origin: "" })).status, 403);
    });
    await t.test("templates and cloud-format JSON imports save locally", async () => {
      let workspace = saveProjectTemplate(latest.workspace!, latest.workspace!.activeProjectId, "Local reusable workflow");
      workspace.projects[0].roadmap.application = "Saved before restart";
      workspace = mergeProjectImport(workspace, parseProjectImport(structuredClone(workspace)));
      assert.equal((await request("PUT", { revision: latest.revision, workspace })).status, 200);
      latest = await snapshot();
      assert.equal(latest.workspace!.projects.length, 2);
      assert.equal(latest.workspace!.templates.length, 2);
      assert.equal(latest.workspace!.projects[0].roadmap.application, "Saved before restart");
    });
    await t.test("concurrent tabs accept one write and return the current snapshot on conflict", async () => {
      const first = structuredClone(latest.workspace!), second = structuredClone(latest.workspace!);
      first.projects[0].roadmap.title = "First tab"; second.projects[0].roadmap.title = "Second tab";
      const responses = await Promise.all([request("PUT", { revision: latest.revision, workspace: first }), request("PUT", { revision: latest.revision, workspace: second })]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      const conflict = await responses.find(response => response.status === 409)!.json();
      latest = await snapshot();
      assert.deepEqual(conflict.snapshot, latest);
      const unchanged = await fetch(`${origin}/api/workspace?revision=${latest.revision}`);
      assert.equal(unchanged.status, 304);
    });
    await t.test("invalid dependency edits are rejected without altering saved content", async () => {
      const invalid = structuredClone(latest.workspace!);
      invalid.projects[0].roadmap.tasks[0].dependsOn = ["missing-task"];
      assert.equal((await request("PUT", { revision: latest.revision, workspace: invalid })).status, 400);
      assert.deepEqual(await snapshot(), latest);
    });
    await t.test("a complete server restart preserves projects, templates, and revision", async () => {
      await stop(); await start();
      assert.deepEqual(await snapshot(), latest);
    });
  } catch (error) { console.error(logs); throw error; }
  finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
