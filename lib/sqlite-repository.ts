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
import { type DiagramType, diagramTypeOf } from "./application-flow";
import { createHash } from "node:crypto";
import { AI_MAX_CONTEXT_BYTES, normalizeAiProposal, assertAiDiagramScope, assertAiDiagramOrder, type AiContext, type AiSession, type AiProvider, type AiProposal } from "./ai-authoring";

const GENERATION_MS = 900_000;
type AuthoringResult = { proposal: AiProposal | null; message: string; questions: string[]; trace: string[] } | { error: string };

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
      if (![0, 1, 2, 3, 4, 5, 6].includes(Number(version))) throw new Error("This database was created by a newer Pathways Local version.");
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
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS project_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result))) STRICT;
        CREATE TABLE IF NOT EXISTS ai_sessions (id TEXT PRIMARY KEY, session TEXT NOT NULL CHECK(json_valid(session)), agent_digest TEXT) STRICT;
        CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, context TEXT CHECK(context IS NULL OR json_valid(context))) STRICT;
        CREATE TABLE IF NOT EXISTS ai_apply_audit (proposal_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt))) STRICT;
        PRAGMA user_version = 6;
      `);
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
    return this.db.prepare(`SELECT id, revision, updated_at, json_extract(definition, '$.projectId') AS project_id, json_extract(definition, '$.name') AS name, json_extract(definition, '$.description') AS description, json_extract(definition, '$.diagramType') AS diagram_type, json_array_length(definition, '$.nodes') AS nodes, json_array_length(definition, '$.edges') AS edges FROM application_flows${where} ORDER BY position, id`).all(...(projectId === undefined ? [] : [projectId])).map(row => ({
      id: String(row.id), projectId: row.project_id === null ? null : String(row.project_id), name: String(row.name), description: String(row.description), revision: Number(row.revision), updatedAt: String(row.updated_at), nodes: Number(row.nodes), edges: Number(row.edges),
      ...(row.diagram_type ? { diagramType: row.diagram_type as DiagramType } : {}),
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
    const previous = this.readFlow(flow.id);
    if (flow.presentationNotes === undefined && previous?.flow.presentationNotes !== undefined) flow.presentationNotes = previous.flow.presentationNotes;
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

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private saveAiSession(session: AiSession) {
    const value = JSON.stringify(session);
    if (Buffer.byteLength(value) > 750_000) throw new WorkspaceError(413, "This conversation is too large. Start a new conversation.");
    this.db.prepare("INSERT INTO ai_sessions (id,session) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET session=excluded.session").run(session.id, value);
    return session;
  }

  private aiContext(projectId: string, diagramType?: DiagramType): AiContext {
    try { this.assertFlowProject(projectId); }
    catch { throw new WorkspaceError(404, "This project does not exist. Choose a project from the local workspace."); }
    const row = this.db.prepare("SELECT state FROM workspace WHERE id=1").get();
    const state = JSON.parse(String(row!.state)) as WorkspaceState;
    const summaries = this.listFlows(projectId);
    if (summaries.length > 40) throw new WorkspaceError(413, "Authoring supports projects with up to 40 diagrams. Split this project before authoring.");
    const context: AiContext = { projectId, projectName: state.workspace.projects.find(p => p.id === projectId)!.roadmap.application,
      flows: summaries.map(item => this.readFlow(item.id)!), ...(diagramType ? { diagramType } : {}) };
    if (Buffer.byteLength(JSON.stringify(context)) > AI_MAX_CONTEXT_BYTES) throw new WorkspaceError(413, "This project's definitions exceed the authoring context limit. Use a smaller project.");
    return context;
  }

  readAuthoringProject(projectId: string) {
    return this.transaction(() => {
      const context = this.aiContext(projectId);
      return { ...context, base: context.flows.map(item => ({ id: item.flow.id, revision: item.revision })) };
    });
  }

  createAiSession(projectId: string, id: string, model: string, provider: AiProvider = "openai", diagramType: DiagramType = "workflow") {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT session FROM ai_sessions WHERE id=?").get(id);
      if (row) {
        const prior = JSON.parse(String(row.session)) as AiSession;
        if (prior.projectId !== projectId || diagramTypeOf(prior) !== diagramType || prior.provider !== provider) throw new WorkspaceError(409, "This conversation belongs to another project or view.");
        return prior;
      }
      const context = this.aiContext(projectId, diagramType), now = Date.now();
      return this.saveAiSession({ id, projectId, userId: "local-owner", projectName: context.projectName, provider, model, diagramType,
        revision: 1, status: "idle", messages: [], proposal: null, questions: [], error: null, trace: [], base: [], lastRequestId: null, startedAt: 0, updatedAt: now });
    });
  }

  getAiSession(id: string): AiSession {
    const row = this.db.prepare("SELECT session FROM ai_sessions WHERE id=?").get(id);
    if (!row) throw new WorkspaceError(404, "This authoring conversation does not exist.");
    const session = JSON.parse(String(row.session)) as AiSession;
    this.assertFlowProject(session.projectId);
    if (session.status === "generating" && Date.now() >= (session.generationExpiresAt ?? 0)) {
      return this.saveAiSession({ ...session, status: "failed", revision: session.revision + 1, updatedAt: Date.now(), error: "Generation was interrupted or timed out. Your conversation is kept; send a new message to retry." });
    }
    return session;
  }

  beginAiMessage(id: string, revision: number, requestId: string, message: string) {
    return this.transaction(() => {
      const session = this.getAiSession(id), now = Date.now();
      if (session.provider !== "openai") throw new WorkspaceError(400, "Local agent drafts are submitted through the agent proposal API.");
      if (session.lastRequestId === requestId) {
        if (session.messages.filter(m => m.role === "user").at(-1)?.content !== message) throw new WorkspaceError(409, "This request ID belongs to another message.");
        return session;
      }
      if (session.revision !== revision) throw new WorkspaceError(409, "This conversation changed. Reload it before sending.");
      if (session.messages.filter(m => m.role === "user").length >= 20) throw new WorkspaceError(400, "Start a new conversation after 20 messages.");
      const active = this.db.prepare("SELECT 1 FROM ai_sessions WHERE json_extract(session,'$.status')='generating' AND json_extract(session,'$.generationExpiresAt')>?").get(now);
      if (active) throw new WorkspaceError(429, "An Astra request is already running. Wait for it to finish.");
      if (this.db.prepare("SELECT 1 FROM ai_jobs WHERE id=?").get(requestId)) throw new WorkspaceError(409, "Use a new request ID for this message.");
      const context = this.aiContext(session.projectId, session.diagramType);
      const next: AiSession = { ...session, revision: session.revision + 1, status: "generating", messages: [...session.messages, { role: "user", content: message }],
        proposal: session.status === "applied" ? null : session.proposal, questions: [], error: null, trace: [],
        base: context.flows.map(item => ({ id: item.flow.id, revision: item.revision })), lastRequestId: requestId, startedAt: now, updatedAt: now, generationExpiresAt: now + GENERATION_MS };
      this.saveAiSession(next);
      this.db.prepare("INSERT INTO ai_jobs (id,session_id,status,context) VALUES (?,?,'queued',?)").run(requestId, id, JSON.stringify(context));
      return next;
    });
  }

  claimAiJob(id: string, requestId: string) {
    return this.transaction(() => {
      const session = this.getAiSession(id), job = this.db.prepare("SELECT status,context FROM ai_jobs WHERE id=? AND session_id=?").get(requestId, id);
      if (!job || job.status !== "queued" || session.lastRequestId !== requestId || session.status !== "generating") return null;
      this.db.prepare("UPDATE ai_jobs SET status='running' WHERE id=?").run(requestId);
      return { session, context: JSON.parse(String(job.context)) as AiContext, timeoutMs: Math.max(1, (session.generationExpiresAt ?? 0) - Date.now()) };
    });
  }

  finishAiMessage(id: string, requestId: string, result: AuthoringResult) {
    return this.transaction(() => {
      const session = this.getAiSession(id);
      if (session.lastRequestId !== requestId || session.status !== "generating") return session;
      const next: AiSession = "error" in result ? { ...session, status: "failed", error: result.error, revision: session.revision + 1, updatedAt: Date.now() } : {
        ...session, status: result.proposal ? "ready" : "questions", messages: [...session.messages, { role: "assistant", content: result.message + (result.questions.length ? "\n\n" + result.questions.join("\n") : "") }],
        proposal: result.proposal, questions: result.questions, trace: result.trace, error: null, revision: session.revision + 1, updatedAt: Date.now() };
      this.saveAiSession(next);
      this.db.prepare("UPDATE ai_jobs SET status='done',context=NULL WHERE id=?").run(requestId);
      return next;
    });
  }

  createAgentProposal(input: { requestId: string; projectId: string; diagramType?: DiagramType; base: { id: string; revision: number }[]; proposal: unknown }) {
    return this.transaction(() => {
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const prior = this.db.prepare("SELECT session,agent_digest FROM ai_sessions WHERE id=?").get(input.requestId);
      if (prior) {
        if (prior.agent_digest !== digest) throw new WorkspaceError(409, "This request ID belongs to a different agent proposal.");
        return JSON.parse(String(prior.session)) as AiSession;
      }
      const context = this.aiContext(input.projectId, input.diagramType);
      this.checkAuthoringBase(context, input.base);
      let proposal: AiProposal;
      try { proposal = normalizeAiProposal(input.proposal, context); }
      catch (error) { throw new WorkspaceError(400, error instanceof Error ? error.message : "Check the agent proposal."); }
      const now = Date.now();
      const session: AiSession = { id: input.requestId, projectId: input.projectId, projectName: context.projectName, userId: "local-owner", provider: "agent", model: "local-agent",
        ...(input.diagramType ? { diagramType: input.diagramType } : {}), revision: 1, status: "ready", messages: [{ role: "assistant", content: proposal.summary }], proposal, questions: [], error: null,
        trace: ["Validated graphs, references, diagram scope, and saved order", "Review assumptions and component responsibilities before applying"], base: input.base, lastRequestId: null, startedAt: 0, updatedAt: now };
      this.saveAiSession(session);
      this.db.prepare("UPDATE ai_sessions SET agent_digest=? WHERE id=?").run(digest, session.id);
      return session;
    });
  }

  private checkAuthoringBase(context: AiContext, base: { id: string; revision: number }[]) {
    if (context.flows.length !== base.length || context.flows.some((item, i) => item.flow.id !== base[i].id || item.revision !== base[i].revision)) {
      throw new WorkspaceError(409, "Project diagrams or their order changed. Read the latest project and refresh the proposal before applying.");
    }
  }

  applyAiProposal(id: string, revision: number, proposalId: string) {
    return this.transaction(() => {
      const session = this.getAiSession(id);
      if (session.proposal?.id !== proposalId) throw new WorkspaceError(409, "This draft changed. Review the current proposal.");
      if (session.status === "applied") return session;
      if (session.status !== "ready" || session.revision !== revision) throw new WorkspaceError(409, "This draft is not ready. Reload the conversation.");
      const context = this.aiContext(session.projectId, session.diagramType);
      this.checkAuthoringBase(context, session.base);
      const proposal = session.proposal, current = new Map(context.flows.map(item => [item.flow.id, item]));
      const allIds = new Set([...current.keys(), ...proposal.flows.map(flow => flow.id)]);
      if (proposal.flowOrder.length !== allIds.size || new Set(proposal.flowOrder).size !== allIds.size || proposal.flowOrder.some(flowId => !allIds.has(flowId))) throw new WorkspaceError(400, "The proposed diagram order is incomplete.");
      try { assertAiDiagramScope(proposal.flows, context); assertAiDiagramOrder(proposal.flowOrder, context); }
      catch (error) { throw new WorkspaceError(400, (error as Error).message); }
      for (const flow of proposal.flows) {
        if (flow.projectId !== session.projectId) throw new WorkspaceError(400, "Every proposed diagram must belong to this project.");
        const existing = current.get(flow.id);
        const saved = existing ? this.updateFlow(flow, existing.revision) : this.createFlow(flow);
        if (!saved) throw new WorkspaceError(409, "A proposed diagram ID already exists or changed. Refresh the draft.");
      }
      const order = this.db.prepare("UPDATE application_flows SET position=? WHERE id=?");
      proposal.flowOrder.forEach((flowId, index) => order.run(index, flowId));
      const next = this.saveAiSession({ ...session, status: "applied", revision: session.revision + 1, updatedAt: Date.now() });
      this.db.prepare("INSERT INTO ai_apply_audit (proposal_id,session_id,receipt) VALUES (?,?,?)").run(proposal.id, id, JSON.stringify({ projectId: session.projectId, provider: session.provider, flowIds: proposal.flows.map(flow => flow.id), appliedAt: new Date().toISOString() }));
      return next;
    });
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
