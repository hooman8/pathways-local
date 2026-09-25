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
import { exampleFlow } from "./flow-fixture";
import type { FlowSnapshot } from "../lib/application-flow";

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
    let savedFlow: FlowSnapshot;
    const flowRequest = (path = "", method = "GET", body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/flows${path}`, {
      method, headers: { "Content-Type": "application/json", Origin: origin, "X-Pathways-Client": "1", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    await t.test("application flow API validates, creates, lists, and atomically edits definitions", async () => {
      const flow = exampleFlow();
      assert.equal((await fetch(`${origin}/flows`)).status, 200);
      assert.equal((await flowRequest("/validate", "POST", { flow })).status, 200);
      assert.deepEqual((await (await flowRequest()).json()).flows, [], "validation must not save");
      const created = await flowRequest("", "POST", { flow });
      assert.equal(created.status, 201, await created.clone().text());
      savedFlow = await created.json();
      assert.equal((await flowRequest("", "POST", { flow })).status, 409);
      const list = await (await flowRequest()).json();
      assert.equal(list.flows[0].id, flow.id);
      assert.equal(list.flows[0].nodes, flow.nodes.length);
      assert.deepEqual(await (await flowRequest(`/${flow.id}`)).json(), savedFlow);
      const edits = await Promise.all(["First editor", "Second editor"].map(name => flowRequest(`/${flow.id}`, "PUT", { flow: { ...flow, name }, revision: 1 })));
      assert.deepEqual(edits.map(result => result.status).sort(), [200, 409]);
      savedFlow = await edits.find(result => result.status === 200)!.json();
      assert.deepEqual((await edits.find(result => result.status === 409)!.json()).snapshot, savedFlow);
      assert.equal((await flowRequest(`/${flow.id}`, "PUT", { flow, revision: 0 })).status, 400);
      assert.equal((await flowRequest("/wrong", "PUT", { flow, revision: 2 })).status, 400);
      assert.equal((await flowRequest("/absent")).status, 404);
      assert.equal((await flowRequest("", "POST", { flow: { ...flow, id: "invalid", edges: [] } })).status, 400);
      assert.deepEqual(await (await flowRequest(`/${flow.id}`)).json(), savedFlow);
      assert.deepEqual(await snapshot(), latest, "flow edits must not change roadmaps");
    });
    await t.test("flow API rejects foreign origins, missing write headers, and oversized JSON", async () => {
      assert.equal((await flowRequest("", "GET", undefined, { Origin: "https://attacker.example" })).status, 403);
      assert.equal((await flowRequest("", "POST", {}, { "X-Pathways-Client": "" })).status, 403);
      assert.equal((await flowRequest("/validate", "POST", {}, { Origin: "" })).status, 403);
      assert.equal((await flowRequest("/validate", "POST", {}, { "Content-Type": "text/plain" })).status, 415);
      assert.equal((await flowRequest("/validate", "POST", { padding: "x".repeat(2_000_000) })).status, 413);
    });
    await t.test("projects share roadmap identity and isolate flows without breaking bookmarks", async () => {
      const projectRequest = (method = "GET", body?: unknown, extra: Record<string, string> = {}) => fetch(`${origin}/api/projects`, {
        method, headers: { "Content-Type": "application/json", "X-Pathways-Client": "1", Origin: origin, ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const catalog = await (await projectRequest()).json();
      assert.equal(catalog.projects.length, 2);
      assert.equal(catalog.unassignedCount, 1);
      assert.equal((await projectRequest("POST", { name: " ", revision: catalog.revision })).status, 400);
      assert.equal((await projectRequest("POST", { name: "New", revision: catalog.revision }, { Origin: "https://attacker.example" })).status, 403);
      assert.equal((await projectRequest("POST", { name: "New", revision: catalog.revision }, { "X-Pathways-Client": "" })).status, 403);
      assert.equal((await projectRequest("POST", { padding: "x".repeat(4096) })).status, 413);
      const result = await projectRequest("POST", { name: "Onboarding", revision: catalog.revision });
      assert.equal(result.status, 201, await result.clone().text());
      const { project, revision } = await result.json();
      assert.equal((await projectRequest("POST", { name: "Other", revision: catalog.revision })).status, 409);
      assert.equal((await projectRequest("POST", { name: " onboarding ", revision })).status, 409);
      latest = await snapshot();
      assert.equal(latest.revision, revision);
      assert.deepEqual(latest.workspace!.projects.at(-1)!.roadmap.tasks, []);
      assert.equal(latest.workspace!.projects.at(-1)!.id, project.id);
      const beforeMove = savedFlow!;
      const move = await flowRequest(`/${beforeMove.flow.id}`, "PUT", { flow: { ...beforeMove.flow, projectId: project.id }, revision: beforeMove.revision });
      assert.equal(move.status, 200, await move.clone().text()); savedFlow = await move.json();
      assert.deepEqual(savedFlow.flow.nodes, beforeMove.flow.nodes);
      assert.deepEqual((await (await flowRequest("?projectId=")).json()).flows, []);
      assert.deepEqual((await (await flowRequest(`?projectId=${catalog.projects[0].id}`)).json()).flows, []);
      assert.equal((await (await flowRequest(`?projectId=${project.id}`)).json()).flows[0].id, savedFlow.flow.id);
      assert.equal((await (await projectRequest()).json()).projects.find((p: { id: string }) => p.id === project.id).flowCount, 1);
      assert.equal((await flowRequest(`/${savedFlow.flow.id}`, "PUT", { flow: { ...savedFlow.flow, projectId: "missing" }, revision: savedFlow.revision })).status, 400);
      const legacy = JSON.parse(JSON.stringify(savedFlow.flow)); delete legacy.projectId;
      const legacySave = await flowRequest(`/${savedFlow.flow.id}`, "PUT", { flow: legacy, revision: savedFlow.revision });
      assert.equal(legacySave.status, 200); savedFlow = await legacySave.json();
      assert.equal(savedFlow.flow.projectId, project.id, "older clients must preserve project assignment");
      assert.deepEqual(await snapshot(), latest, "moving a flow must not edit roadmap content");
      assert.equal((await fetch(`${origin}/flows?flow=${savedFlow.flow.id}`)).status, 200);
    });
    let expectedFlowOrder: string[];
    await t.test("flow order API persists an exact project permutation and rejects stale or unsafe writes", async () => {
      const projectId = savedFlow!.flow.projectId;
      const reorder = (body: unknown, extra: Record<string, string> = {}) => fetch(`${origin}/api/flow-order`, {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Pathways-Client": "1", Origin: origin, ...extra }, body: JSON.stringify(body),
      });
      for (const id of ["detail-two", "detail-three"]) assert.equal((await flowRequest("", "POST", { flow: { ...exampleFlow(), id, projectId } })).status, 201);
      assert.equal((await flowRequest("", "POST", { flow: { ...exampleFlow(), id: "outside" } })).status, 201);
      const list = (await (await flowRequest(`?projectId=${projectId}`)).json()).flows;
      const expectedOrder = list.map((flow: { id: string }) => flow.id);
      expectedFlowOrder = [...expectedOrder].reverse();
      const body = { projectId, expectedOrder, flowIds: expectedFlowOrder };
      assert.equal((await reorder(body, { Origin: "https://attacker.example" })).status, 403);
      assert.equal((await reorder(body, { "X-Pathways-Client": "" })).status, 403);
      assert.equal((await reorder({ ...body, projectId: undefined })).status, 400);
      assert.equal((await reorder({ ...body, projectId: "missing" })).status, 400);
      assert.equal((await reorder({ ...body, flowIds: [expectedOrder[0], expectedOrder[0], "outside"] })).status, 400);
      const results = await Promise.all([reorder(body), reorder(body)]);
      assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
      const saved = await results.find(response => response.status === 200)!.json();
      assert.deepEqual(saved.flows.map((flow: { id: string }) => flow.id), expectedFlowOrder);
      assert.deepEqual(await (await flowRequest(`/${savedFlow!.flow.id}`)).json(), savedFlow!);
      assert.deepEqual(await snapshot(), latest);
      assert.deepEqual((await (await flowRequest("?projectId=")).json()).flows.map((flow: { id: string }) => flow.id), ["outside"]);
    });
    await t.test("a complete server restart preserves projects, templates, and revision", async () => {
      await stop(); await start();
      assert.deepEqual(await snapshot(), latest);
      assert.deepEqual(await (await flowRequest(`/${savedFlow.flow.id}`)).json(), savedFlow);
      assert.deepEqual((await (await flowRequest(`?projectId=${savedFlow.flow.projectId}`)).json()).flows.map((flow: { id: string }) => flow.id), expectedFlowOrder);
    });
  } catch (error) { console.error(logs); throw error; }
  finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
