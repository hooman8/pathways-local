import test from "node:test";
import assert from "node:assert/strict";
import { SqliteRepository } from "../lib/sqlite-repository";
import { localOwner } from "../lib/local-access";
import { WorkspaceError, WorkspaceStore } from "../lib/workspace-store";
import { normalizeAiProposal } from "../lib/ai-authoring";
import { runAuthoring } from "../lib/authoring-runner";
import { exampleFlow } from "./flow-fixture";
import { architectureFixture } from "./architecture-fixture";
import { agentDraft } from "./authoring-fixture";

async function setup() { const repository = new SqliteRepository(":memory:"); const snapshot = await new WorkspaceStore(repository, localOwner.email).get(localOwner); return { repository, projectId: snapshot.workspace!.activeProjectId }; }

test("local agents preview and atomically apply linked diagrams without an API key; retries do not duplicate", async () => {
  const { repository, projectId } = await setup();
  try {
    const request = { requestId: crypto.randomUUID(), projectId, diagramType: "workflow" as const, base: [], proposal: agentDraft() };
    const draft = repository.createAgentProposal(request);
    assert.deepEqual(repository.listFlows(projectId), [], "proposing must not publish");
    assert.deepEqual(repository.createAgentProposal(request), draft);
    assert.throws(() => repository.createAgentProposal({ ...request, proposal: { ...request.proposal, summary: "Another request" } }), /different agent proposal/);
    const saved = repository.applyAiProposal(draft.id, draft.revision, draft.proposal!.id);
    assert.equal(saved.status, "applied");
    assert.deepEqual(repository.applyAiProposal(draft.id, draft.revision, draft.proposal!.id), saved);
    const definitions = repository.listFlows(projectId).map(item => repository.readFlow(item.id)!.flow);
    assert.equal(definitions.length, 2);
    assert.equal(definitions[0].nodes.find(node => node.id === "work")!.subflowId, definitions[1].id);
    const exported = repository.exportProjectBundle(projectId);
    assert.ok(!JSON.stringify(exported).includes("local-agent"));
    assert.equal(exported.flows[0].presentationNotes, request.proposal.flows[0].presentationNotes);
  } finally { repository.close(); }
});
test("stale agent drafts, cross-view changes, forged fields, and missing order fail without partial writes", async () => {
  const { repository, projectId } = await setup();
  try {
    const request = { requestId: crypto.randomUUID(), projectId, diagramType: "workflow" as const, base: [], proposal: agentDraft() };
    const draft = repository.createAgentProposal(request);
    repository.createFlow({ ...exampleFlow(), projectId });
    assert.throws(() => repository.applyAiProposal(draft.id, draft.revision, draft.proposal!.id), /changed/);
    assert.equal(repository.listFlows(projectId).length, 1);
    assert.throws(() => repository.createAgentProposal({ ...request, requestId: crypto.randomUUID() }), /changed/);
    const current = repository.readAuthoringProject(projectId), arch = architectureFixture();
    const { projectId: _project, version: _version, ...definition } = arch;
    assert.throws(() => repository.createAgentProposal({ ...request, requestId: crypto.randomUUID(), base: current.base, proposal: { summary: "Wrong view", assumptions: [], flows: [definition], flowOrder: [current.base[0].id, arch.id] } }), /workflow diagrams/);
    assert.throws(() => normalizeAiProposal({ ...agentDraft(), apiKey: "not-allowed" }, current), /Unrecognized/);
    assert.equal(repository.getAiSession(draft.id).status, "ready");
  } finally { repository.close(); }
});
test("a collision after the first diagram write rolls back every change and the Apply receipt", async () => {
  const { repository, projectId } = await setup();
  try {
    const draft = repository.createAgentProposal({ requestId: crypto.randomUUID(), projectId, diagramType: "workflow", base: [], proposal: agentDraft() });
    const collision = { ...exampleFlow(), id: draft.proposal!.flows[1].id, projectId: null };
    repository.createFlow(collision);
    assert.throws(() => repository.applyAiProposal(draft.id, draft.revision, draft.proposal!.id), /already exists/);
    assert.deepEqual(repository.listFlows(projectId), [], "the first diagram write must roll back");
    assert.equal(repository.readFlow(collision.id)!.flow.name, collision.name);
    assert.equal(repository.getAiSession(draft.id).status, "ready", "a failed Apply is still reviewable");
  } finally { repository.close(); }
});
test("Astra jobs persist before dispatch, claim once, preserve request identity, and apply only reviewed output", async () => {
  const { repository, projectId } = await setup();
  try {
    const session = repository.createAiSession(projectId, crypto.randomUUID(), "gpt-6-astra"), requestId = crypto.randomUUID();
    const started = repository.beginAiMessage(session.id, session.revision, requestId, "Create a request workflow.");
    assert.equal(started.status, "generating");
    assert.deepEqual(repository.beginAiMessage(session.id, session.revision, requestId, "Create a request workflow."), started);
    assert.throws(() => repository.beginAiMessage(session.id, session.revision, requestId, "Different message"), /another message/);
    const another = repository.createAiSession(projectId, crypto.randomUUID(), "gpt-6-astra");
    assert.throws(() => repository.beginAiMessage(another.id, another.revision, crypto.randomUUID(), "More"), (error: unknown) => error instanceof WorkspaceError && error.status === 429);
    const job = repository.claimAiJob(session.id, requestId)!;
    assert.ok(job.timeoutMs > 0);
    assert.equal(repository.claimAiJob(session.id, requestId), null);
    const ready = repository.finishAiMessage(session.id, requestId, { proposal: normalizeAiProposal(agentDraft(), job.context), message: "Ready", questions: [], trace: ["Validated"] });
    assert.equal(ready.status, "ready");
    assert.equal(repository.listFlows(projectId).length, 0);
    assert.equal(repository.applyAiProposal(ready.id, ready.revision, ready.proposal!.id).status, "applied");
    const next = repository.beginAiMessage(session.id, ready.revision + 1, crypto.randomUUID(), "Refine");
    assert.equal(next.proposal, null, "an applied proposal is not reused as an unsaved draft");
    assert.deepEqual(repository.finishAiMessage(session.id, requestId, { error: "late result" }), next, "a superseded job cannot overwrite a newer request");
  } finally { repository.close(); }
});
test("authoring runner asks for incomplete business rules and refuses unsupported actions", async () => {
  const { repository, projectId } = await setup();
  try {
    const session = repository.createAiSession(projectId, crypto.randomUUID(), "gpt-6-astra");
    const questions = await runAuthoring(repository.readAuthoringProject(projectId), session, async () => ({ role: "model", parts: [{ functionCall: { name: "ask_questions", args: { message: "Clarify approval", questions: ["Who approves the request?"] } } }] }), AbortSignal.timeout(1000));
    assert.equal(questions.proposal, null);
    assert.equal(questions.questions.length, 1);
    await assert.rejects(() => runAuthoring(repository.readAuthoringProject(projectId), session, async () => ({ role: "model", parts: [{ functionCall: { name: "execute_code", args: {} } }] }), AbortSignal.timeout(1000)), /eight steps/);
  } finally { repository.close(); }
});
