import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateWorkspace } from "./projects";
import type { WorkspaceRepository, WorkspaceState } from "./workspace-store";

export class SqliteRepository implements WorkspaceRepository {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error("This database was created by a newer Pathways Local version.");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          state TEXT NOT NULL CHECK (json_valid(state))
            CHECK (json_extract(state, '$.revision') = revision)
        ) STRICT;
        PRAGMA user_version = 1;
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
