import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportBundle, prepareBundleImport, type BundleImportResult } from "./project-bundle";
import { parseTransfer } from "./project-transfer-request";
import { content } from "./shared";
import { WorkspaceError } from "./workspace-store";
import { validateWorkspace } from "./projects";
import type { WorkspaceRepository, WorkspaceState } from "./workspace-store";
import { validateFlow, type ApplicationFlow, type FlowSnapshot, type FlowSummary } from "./application-flow";

export class UnknownFlowProjectError extends Error {
  constructor() { super("Choose an existing project, or use null for an unassigned flow."); }
}
export class FlowOrderError extends Error {
  constructor(public status: 400 | 409, message: string) { super(message); }
}

export class SqliteRepository implements WorkspaceRepository {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    let migrating = false;
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      this.db.exec("BEGIN IMMEDIATE"); migrating = true;
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5) throw new Error("This database was created by a newer Pathways Local version.");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          state TEXT NOT NULL CHECK (json_valid(state))
            CHECK (json_extract(state, '$.revision') = revision)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS application_flows (
          id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          updated_at TEXT NOT NULL,
          definition TEXT NOT NULL CHECK (json_valid(definition))
            CHECK (json_extract(definition, '$.id') = id)
        ) STRICT;
      `);
      if (Number(version) < 4) {
        this.db.exec(`
          ALTER TABLE application_flows ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY json_extract(definition, '$.projectId') ORDER BY updated_at DESC, id) - 1 AS position
            FROM application_flows
          )
          UPDATE application_flows SET position = (SELECT position FROM ranked WHERE ranked.id = application_flows.id);
          PRAGMA user_version = 4;
        `);
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS project_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result))) STRICT; PRAGMA user_version = 5;`);
      this.db.exec("COMMIT"); migrating = false;
    } catch (error) { if (migrating) this.db.exec("ROLLBACK"); this.db.close(); throw error; }
  }

  async read(): Promise<WorkspaceState | null> {
    const row = this.db.prepare("SELECT state FROM workspace WHERE id = 1").get();
    if (!row) return null;
    const state = JSON.parse(row.state as string) as WorkspaceState;
    return { ...state, workspace: validateWorkspace(state.workspace) };
  }

  async version(): Promise<Pick<WorkspaceState, "revision" | "members"> | null> {
    const row = this.db.prepare("SELECT revision, json_extract(state, '$.members') AS members FROM workspace WHERE id = 1").get();
    return row ? { revision: Number(row.revision), members: JSON.parse(row.members as string) } : null;
  }

  async initialize(state: WorkspaceState): Promise<void> {
    // Concurrent first loads must never replace an existing workspace.
    this.db.prepare("INSERT INTO workspace (id, revision, state) VALUES (1, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(state.revision, JSON.stringify(state));
  }

  async compareAndSwap(before: WorkspaceState, next: WorkspaceState): Promise<boolean> {
    if (next.revision !== before.revision + 1) throw new Error("A save must advance the workspace revision by one.");
    // One atomic statement checks the revision and updates all content, even
    // across separate database connections and application processes.
    const result = this.db.prepare("UPDATE workspace SET revision = ?, state = ? WHERE id = 1 AND revision = ?")
      .run(next.revision, JSON.stringify(next), before.revision);
    return Number(result.changes) === 1;
  }

  close() { this.db.close(); }

  listFlows(projectId?: string | null): FlowSummary[] {
    const where = projectId === undefined ? "" : " WHERE json_extract(definition, '$.projectId') IS ?";
    return this.db.prepare(`SELECT id, revision, updated_at, json_extract(definition, '$.projectId') AS project_id, json_extract(definition, '$.name') AS name, json_extract(definition, '$.description') AS description, json_array_length(definition, '$.nodes') AS nodes, json_array_length(definition, '$.edges') AS edges FROM application_flows${where} ORDER BY position, id`).all(...(projectId === undefined ? [] : [projectId])).map(row => ({
      id: String(row.id), projectId: row.project_id === null ? null : String(row.project_id), name: String(row.name), description: String(row.description), revision: Number(row.revision), updatedAt: String(row.updated_at), nodes: Number(row.nodes), edges: Number(row.edges),
    }));
  }

  readFlow(id: string): FlowSnapshot | null {
    const row = this.db.prepare("SELECT revision, updated_at, definition FROM application_flows WHERE id = ?").get(id);
    return row ? { flow: validateFlow(JSON.parse(String(row.definition))), revision: Number(row.revision), updatedAt: String(row.updated_at) } : null;
  }

  createFlow(input: ApplicationFlow): FlowSnapshot | null {
    const flow = validateFlow(input), updatedAt = new Date().toISOString();
    this.assertFlowProject(flow.projectId);
    const result = this.db.prepare("INSERT INTO application_flows (id, revision, updated_at, definition, position) VALUES (?, 1, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM application_flows WHERE json_extract(definition, '$.projectId') IS ?)) ON CONFLICT(id) DO NOTHING").run(flow.id, updatedAt, JSON.stringify(flow), flow.projectId);
    return Number(result.changes) ? { flow, revision: 1, updatedAt } : null;
  }

  updateFlow(input: ApplicationFlow, revision: number): FlowSnapshot | null {
    const flow = validateFlow(input), updatedAt = new Date().toISOString();
    this.assertFlowProject(flow.projectId);
    const result = this.db.prepare(`UPDATE application_flows SET revision = revision + 1, updated_at = ?, definition = ?,
      position = CASE WHEN json_extract(definition, '$.projectId') IS ? THEN position ELSE
        (SELECT COALESCE(MAX(position), -1) + 1 FROM application_flows WHERE json_extract(definition, '$.projectId') IS ?) END
      WHERE id = ? AND revision = ?`).run(updatedAt, JSON.stringify(flow), flow.projectId, flow.projectId, flow.id, revision);
    return Number(result.changes) ? { flow, revision: revision + 1, updatedAt } : null;
  }

  reorderFlows(projectId: string | null, expectedOrder: string[], flowIds: string[]): FlowSummary[] {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.assertFlowProject(projectId);
      const current = this.listFlows(projectId).map(flow => flow.id);
      if (current.length !== expectedOrder.length || current.some((id, index) => id !== expectedOrder[index])) {
        throw new FlowOrderError(409, "This project's flow list changed. Refresh the list before arranging it again.");
      }
      if (flowIds.length !== current.length || new Set(flowIds).size !== current.length || flowIds.some(id => !current.includes(id))) {
        throw new FlowOrderError(400, "Include every flow in this project exactly once.");
      }
      const update = this.db.prepare("UPDATE application_flows SET position = ? WHERE id = ?");
      flowIds.forEach((id, index) => update.run(index, id));
      const flows = this.listFlows(projectId);
      this.db.exec("COMMIT");
      return flows;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  exportProjectBundle(projectId: string) {
    this.db.exec("BEGIN");
    try {
      const row = this.db.prepare("SELECT state FROM workspace WHERE id = 1").get();
      if (!row) throw new WorkspaceError(404, "This workspace does not exist.");
      const state = JSON.parse(String(row.state)) as WorkspaceState;
      const bundle = exportBundle(validateWorkspace(state.workspace), projectId, this.listFlows(projectId).map(flow => this.readFlow(flow.id)!.flow));
      this.db.exec("COMMIT"); return bundle;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  importProjectBundle(input: unknown): BundleImportResult {
    const request = parseTransfer(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.db.prepare("SELECT digest,result FROM project_imports WHERE id = ?").get(request.importId);
      if (receipt) {
        if (receipt.digest !== request.digest) throw new WorkspaceError(409, "This import ID was already used for a different project file.");
        this.db.exec("COMMIT"); return JSON.parse(String(receipt.result));
      }
      const row = this.db.prepare("SELECT state FROM workspace WHERE id = 1").get();
      if (!row) throw new WorkspaceError(404, "Open the workspace before importing.");
      const state = JSON.parse(String(row.state)) as WorkspaceState;
      if (state.revision !== request.revision) throw new WorkspaceError(409, "The workspace changed. Refresh and review the import again.");
      const prepared = prepareBundleImport(validateWorkspace(state.workspace), request.bundle, request.name);
      if (Buffer.byteLength(JSON.stringify(prepared.workspace)) > 1_500_000) throw new WorkspaceError(413, "This import would exceed the workspace size limit.");
      const next = { ...state, workspace: content(prepared.workspace), revision: state.revision + 1, updatedAt: new Date().toISOString(), updatedBy: "Local owner" };
      this.db.prepare("UPDATE workspace SET revision = ?,state = ? WHERE id = 1").run(next.revision, JSON.stringify(next));
      for (const flow of prepared.flows) { if (!this.createFlow(flow)) throw new Error("Generated flow ID collision; retry the import."); }
      this.db.prepare("INSERT INTO project_imports (id,digest,result) VALUES (?,?,?)").run(request.importId, request.digest, JSON.stringify(prepared.result));
      this.db.exec("COMMIT"); return prepared.result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private assertFlowProject(projectId: string | null) {
    if (projectId === null) return;
    // Projects cannot be deleted through the workspace API. The same project
    // identity owns a roadmap and any number of flows; no second project catalog.
    const found = this.db.prepare("SELECT 1 FROM workspace, json_each(workspace.state, '$.workspace.projects') AS project WHERE json_extract(project.value, '$.id') = ?").get(projectId);
    if (!found) throw new UnknownFlowProjectError();
  }
}

const runtime = globalThis as typeof globalThis & { pathwaysSqlite?: { filename: string; repository: SqliteRepository } };
export function localRepository() {
  const filename = resolve(process.env.PATHWAYS_DB_PATH ?? "data/pathways.sqlite");
  if (!runtime.pathwaysSqlite || runtime.pathwaysSqlite.filename !== filename) {
    runtime.pathwaysSqlite?.repository.close();
    runtime.pathwaysSqlite = { filename, repository: new SqliteRepository(filename) };
  }
  return runtime.pathwaysSqlite.repository;
}
