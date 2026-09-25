import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateWorkspace } from "./projects";
import type { WorkspaceRepository, WorkspaceState } from "./workspace-store";
import { validateFlow, type ApplicationFlow, type FlowSnapshot, type FlowSummary } from "./application-flow";

export class UnknownFlowProjectError extends Error {
  constructor() { super("Choose an existing project, or use null for an unassigned flow."); }
}

export class SqliteRepository implements WorkspaceRepository {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error("This database was created by a newer Pathways Local version.");
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
        PRAGMA user_version = 3;
      `);
    } catch (error) { this.db.close(); throw error; }
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
    return this.db.prepare(`SELECT id, revision, updated_at, json_extract(definition, '$.projectId') AS project_id, json_extract(definition, '$.name') AS name, json_extract(definition, '$.description') AS description, json_array_length(definition, '$.nodes') AS nodes, json_array_length(definition, '$.edges') AS edges FROM application_flows${where} ORDER BY updated_at DESC, id`).all(...(projectId === undefined ? [] : [projectId])).map(row => ({
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
    const result = this.db.prepare("INSERT INTO application_flows (id, revision, updated_at, definition) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO NOTHING").run(flow.id, updatedAt, JSON.stringify(flow));
    return Number(result.changes) ? { flow, revision: 1, updatedAt } : null;
  }

  updateFlow(input: ApplicationFlow, revision: number): FlowSnapshot | null {
    const flow = validateFlow(input), updatedAt = new Date().toISOString();
    this.assertFlowProject(flow.projectId);
    const result = this.db.prepare("UPDATE application_flows SET revision = revision + 1, updated_at = ?, definition = ? WHERE id = ? AND revision = ?").run(updatedAt, JSON.stringify(flow), flow.id, revision);
    return Number(result.changes) ? { flow, revision: revision + 1, updatedAt } : null;
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
