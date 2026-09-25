import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository, UnknownFlowProjectError, FlowOrderError } from "../lib/sqlite-repository";
import { WorkspaceStore, WorkspaceError } from "../lib/workspace-store";
import { localOwner } from "../lib/local-access";
import { saveProjectTemplate, createProject } from "../lib/projects";
import { transferFixture } from "./bundle-fixture";
import { exampleFlow } from "./flow-fixture";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pathways-sqlite-"));
  return { directory, filename: join(directory, "nested", "workspace.sqlite") };
}

test("SQLite preserves workspace, templates, and revision after closing and reopening", async () => {
  const { directory, filename } = fixture();
  let repository = new SqliteRepository(filename);
  try {
    const store = new WorkspaceStore(repository, localOwner.email);
    assert.equal(await repository.read(), null);
    assert.equal(await repository.version(), null);
    const first = await store.get(localOwner);
    const workspace = saveProjectTemplate(first.workspace!, first.workspace!.activeProjectId, "Reusable workflow");
    workspace.projects[0].roadmap.application = "Persisted local project";
    const saved = await store.save(localOwner, first.revision, workspace);
    repository.close();
    repository = new SqliteRepository(filename);
    const reopened = await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    assert.deepEqual(reopened, saved);
    assert.equal((await repository.version())!.revision, saved.revision);
    const stored = (await repository.read())!;
    await repository.initialize({ ...stored, revision: stored.revision + 10 });
    assert.deepEqual(await repository.read(), stored, "initialization cannot overwrite saved content");
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("two SQLite connections reject stale writes and preserve the winning complete snapshot", async () => {
  const { directory, filename } = fixture();
  const a = new SqliteRepository(filename), b = new SqliteRepository(filename);
  try {
    const first = new WorkspaceStore(a, localOwner.email), second = new WorkspaceStore(b, localOwner.email);
    const original = await first.get(localOwner);
    const left = structuredClone(original.workspace!), right = structuredClone(original.workspace!);
    left.projects[0].roadmap.application = "Left"; right.projects[0].roadmap.application = "Right";
    const results = await Promise.allSettled([first.save(localOwner, original.revision, left), second.save(localOwner, original.revision, right)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof WorkspaceError);
    assert.equal(rejected.reason.status, 409);
    const saved = await first.get(localOwner);
    assert.equal(saved.revision, original.revision + 1);
    assert.deepEqual(await second.get(localOwner), saved);
    assert.deepEqual(saved.workspace, results.find(result => result.status === "fulfilled")!.value.workspace);
  } finally { a.close(); b.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("opening a newer SQLite schema refuses to downgrade it", () => {
  const { directory } = fixture();
  const filename = join(directory, "newer.sqlite");
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA user_version = 6;"); database.close();
  try {
    assert.throws(() => new SqliteRepository(filename), /newer Pathways/);
    const check = new DatabaseSync(filename);
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 6);
    check.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("flow definitions survive restart and reject duplicate IDs and stale revisions", () => {
  const { directory, filename } = fixture();
  let a = new SqliteRepository(filename);
  const b = new SqliteRepository(filename);
  try {
    const flow = exampleFlow(), created = a.createFlow(flow)!;
    assert.equal(created.revision, 1);
    assert.equal(b.createFlow({ ...flow, name: "Duplicate" }), null);
    assert.deepEqual(b.readFlow(flow.id), created);
    const saved = a.updateFlow({ ...flow, name: "Updated" }, 1)!;
    assert.equal(saved.revision, 2);
    assert.equal(b.updateFlow({ ...flow, name: "Stale" }, 1), null);
    assert.equal(b.updateFlow({ ...flow, id: "missing" }, 1), null);
    assert.throws(() => a.createFlow({ ...flow, nodes: [] }));
    a.close(); a = new SqliteRepository(filename);
    assert.deepEqual(a.readFlow(flow.id), saved);
    assert.equal(a.listFlows().length, 1);
    assert.equal(a.listFlows()[0].name, "Updated");
    assert.equal(a.listFlows()[0].nodes, flow.nodes.length);
  } finally { a.close(); b.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("schema 1 migration adds flow storage without changing the existing workspace", async () => {
  const { directory, filename } = fixture();
  let repository = new SqliteRepository(filename);
  try {
    const expected = await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    repository.close();
    const old = new DatabaseSync(filename);
    old.exec("DROP TABLE application_flows; PRAGMA user_version = 1;"); old.close();
    repository = new SqliteRepository(filename);
    assert.deepEqual(await new WorkspaceStore(repository, localOwner.email).get(localOwner), expected);
    assert.equal(repository.listFlows().length, 0);
    assert.equal(repository.createFlow(exampleFlow())?.revision, 1);
    const check = new DatabaseSync(filename);
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 5); check.close();
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("project moves preserve links, reject missing projects and stale moves, and persist across restart", async () => {
  const { directory, filename } = fixture();
  let repository = new SqliteRepository(filename);
  try {
    const store = new WorkspaceStore(repository, localOwner.email), initial = await store.get(localOwner);
    const project = createProject({ version: 1, application: "Other", title: "Other", tasks: [] }, "Other", "Other");
    const workspace = { ...initial.workspace!, projects: [...initial.workspace!.projects, project] };
    await store.save(localOwner, initial.revision, workspace);
    const flow = exampleFlow();
    flow.nodes.find(node => node.id === "work")!.kind = "subflow";
    flow.nodes.find(node => node.id === "work")!.subflowId = "detail";
    repository.createFlow(flow);
    assert.equal(repository.listFlows(null).length, 1);
    assert.throws(() => repository.updateFlow({ ...flow, projectId: "unknown" }, 1), UnknownFlowProjectError);
    const moved = repository.updateFlow({ ...flow, projectId: project.id }, 1)!;
    assert.equal(repository.updateFlow({ ...flow, projectId: workspace.projects[0].id }, 1), null);
    assert.deepEqual(repository.listFlows(null), []);
    assert.deepEqual(repository.listFlows(workspace.projects[0].id), []);
    assert.equal(repository.listFlows(project.id)[0].id, flow.id);
    repository.close(); repository = new SqliteRepository(filename);
    assert.deepEqual(repository.readFlow(flow.id), moved);
    assert.deepEqual(moved.flow.nodes, flow.nodes);
    assert.deepEqual(moved.flow.edges, flow.edges);
    assert.equal((await repository.read())!.revision, initial.revision + 1);
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("schema 2 definitions without projectId open as Unassigned without rewriting their content", () => {
  const { directory, filename } = fixture();
  const original = exampleFlow();
  const legacy = JSON.parse(JSON.stringify(original)); delete legacy.projectId;
  let repository = new SqliteRepository(filename); repository.close();
  const old = new DatabaseSync(filename);
  old.prepare("INSERT INTO application_flows (id, revision, updated_at, definition) VALUES (?, 7, ?, ?)").run(legacy.id, "2026-01-01T00:00:00Z", JSON.stringify(legacy));
  old.exec("ALTER TABLE application_flows DROP COLUMN position; PRAGMA user_version = 2;"); old.close();
  try {
    repository = new SqliteRepository(filename);
    assert.deepEqual(repository.readFlow(legacy.id), { flow: original, revision: 7, updatedAt: "2026-01-01T00:00:00Z" });
    assert.equal(repository.listFlows(null)[0].projectId, null);
    const check = new DatabaseSync(filename);
    assert.equal(check.prepare("SELECT definition FROM application_flows").get()!.definition, JSON.stringify(legacy));
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 5); check.close();
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("flow ordering is project-scoped, persistent, and independent of content revisions", async () => {
  const { directory, filename } = fixture();
  let repository = new SqliteRepository(filename);
  const other = new SqliteRepository(filename);
  try {
    const workspace = await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    const projectId = workspace.workspace!.projects[0].id;
    const a = repository.createFlow({ ...exampleFlow(), id: "a", projectId })!;
    const b = repository.createFlow({ ...exampleFlow(), id: "b", projectId })!;
    const c = repository.createFlow({ ...exampleFlow(), id: "c", projectId })!;
    const outside = repository.createFlow({ ...exampleFlow(), id: "outside" })!;
    const ids = () => repository.listFlows(projectId).map(flow => flow.id);
    assert.deepEqual(ids(), ["a", "b", "c"], "new flows append");
    repository.reorderFlows(projectId, ids(), ["c", "a", "b"]);
    assert.deepEqual(ids(), ["c", "a", "b"]);
    for (const snapshot of [a, b, c, outside]) assert.deepEqual(repository.readFlow(snapshot.flow.id), snapshot);
    assert.deepEqual(await new WorkspaceStore(repository, localOwner.email).get(localOwner), workspace);
    assert.throws(() => other.reorderFlows(projectId, ["a", "b", "c"], ["b", "a", "c"]), (error: unknown) => error instanceof FlowOrderError && error.status === 409);
    for (const invalid of [["c", "c", "a"], ["c", "a"], ["c", "a", "outside"]]) {
      assert.throws(() => repository.reorderFlows(projectId, ids(), invalid), (error: unknown) => error instanceof FlowOrderError && error.status === 400);
      assert.deepEqual(ids(), ["c", "a", "b"], "failed reorders are atomic");
    }
    repository.updateFlow({ ...a.flow, name: "Edited after ordering" }, a.revision);
    assert.deepEqual(ids(), ["c", "a", "b"], "editing preserves position");
    repository.updateFlow({ ...outside.flow, projectId }, outside.revision);
    assert.deepEqual(ids(), ["c", "a", "b", "outside"], "moving into a project appends");
    assert.throws(() => other.reorderFlows(projectId, ["c", "a", "b"], ["a", "b", "c"]), FlowOrderError);
    repository.updateFlow({ ...b.flow, projectId: null }, b.revision);
    assert.deepEqual(ids(), ["c", "a", "outside"]);
    repository.createFlow({ ...exampleFlow(), id: "unassigned-second" });
    repository.reorderFlows(null, ["b", "unassigned-second"], ["unassigned-second", "b"]);
    assert.deepEqual(ids(), ["c", "a", "outside"]);
    repository.close(); repository = new SqliteRepository(filename);
    assert.deepEqual(ids(), ["c", "a", "outside"]);
    assert.deepEqual(repository.listFlows(null).map(flow => flow.id), ["unassigned-second", "b"]);
  } finally { repository.close(); other.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("schema 3 migration freezes the existing display order without editing definitions", () => {
  const { directory, filename } = fixture();
  let repository = new SqliteRepository(filename);
  for (const id of ["a", "b", "c"]) repository.createFlow({ ...exampleFlow(), id });
  repository.close();
  const old = new DatabaseSync(filename);
  old.exec("ALTER TABLE application_flows DROP COLUMN position; PRAGMA user_version = 3;");
  old.prepare("UPDATE application_flows SET updated_at = ? WHERE id = ?").run("2026-01-02T00:00:00Z", "b");
  old.prepare("UPDATE application_flows SET updated_at = ? WHERE id != ?").run("2026-01-01T00:00:00Z", "b");
  const expected = old.prepare("SELECT id,revision,updated_at,definition FROM application_flows ORDER BY updated_at DESC,id").all(); old.close();
  try {
    repository = new SqliteRepository(filename);
    assert.deepEqual(repository.listFlows(null).map(flow => flow.id), ["b", "a", "c"]);
    for (const row of expected) assert.deepEqual(repository.readFlow(String(row.id)), { flow: JSON.parse(String(row.definition)), revision: row.revision, updatedAt: row.updated_at });
    repository.close(); repository = new SqliteRepository(filename);
    assert.deepEqual(repository.listFlows(null).map(flow => flow.id), ["b", "a", "c"]);
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});


test("complete project imports are atomic and retries return the same imported project", async () => {
  const { directory, filename } = fixture();
  const repository = new SqliteRepository(filename);
  try {
    const initial = await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    const { bundle } = transferFixture();
    const request = { bundle, revision: initial.revision, importId: crypto.randomUUID() };
    const injected = new DatabaseSync(filename);
    injected.exec("CREATE TRIGGER fail_import BEFORE INSERT ON application_flows WHEN (SELECT COUNT(*) FROM application_flows) = 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    assert.throws(() => repository.importProjectBundle(request), /injected failure/);
    assert.deepEqual(await new WorkspaceStore(repository, localOwner.email).get(localOwner), initial);
    assert.equal(repository.listFlows().length, 0);
    injected.exec("DROP TRIGGER fail_import;"); injected.close();
    const imported = repository.importProjectBundle(request);
    assert.deepEqual(repository.importProjectBundle(request), imported);
    const exported = repository.exportProjectBundle(imported.project.id);
    assert.deepEqual(exported.flowOrder, imported.flowIds);
    assert.equal(exported.flows[0].nodes.find(node => node.id === "work")!.subflowId, imported.flowIds[1]);
    assert.equal((await repository.read())!.workspace.projects.length, 2);
    assert.throws(() => repository.importProjectBundle({ ...request, name: "changed" }), /already used/);
    assert.throws(() => repository.importProjectBundle({ ...request, importId: crypto.randomUUID() }), /workspace changed/);
    assert.equal(repository.listFlows().length, 2);
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});
