import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../lib/sqlite-repository";
import { WorkspaceStore, WorkspaceError } from "../lib/workspace-store";
import { localOwner } from "../lib/local-access";
import { saveProjectTemplate } from "../lib/projects";
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
  database.exec("PRAGMA user_version = 3;"); database.close();
  try {
    assert.throws(() => new SqliteRepository(filename), /newer Pathways/);
    const check = new DatabaseSync(filename);
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 3);
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
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 2); check.close();
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});
