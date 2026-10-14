import test from "node:test";
import assert from "node:assert/strict";
import { exportBundle, prepareBundleImport, validateBundle } from "../lib/project-bundle";
import * as hosted from "./hosted-contract/project-bundle";
import { architectureFixture } from "./architecture-fixture";
import { transferFixture } from "./bundle-fixture";
import { componentKinds } from "../lib/application-flow";

test("hosted 1.1 project → local → hosted preserves architecture, workflows, metadata and linked diagrams", () => {
  const { workspace, bundle } = transferFixture();
  const originalWorkspace = structuredClone(workspace);
  const architecture = { ...architectureFixture(), projectId: bundle.project.id, presentationNotes: "Explain the components, boundaries and two-way synchronization.\nThen describe server-only persistence." };
  componentKinds.forEach((kind, index) => {
    architecture.nodes.push({ id: `kind-${kind}`, kind, title: `${kind} component`, actor: "Example system", phase: "", description: `An example ${kind} responsibility.`, checks: ["Verify its connection."], groupId: architecture.groups![0].id });
    architecture.edges.push({ id: `kind-edge-${index}`, source: architecture.nodes[0].id, target: `kind-${kind}`, kind: "next", label: "Uses", direction: index % 2 ? "both" : "forward" });
  });
  const link = architecture.nodes.find(node => node.kind === "subflow");
  if (link) link.subflowId = bundle.flows[0].id;
  bundle.flows[0].presentationNotes = "Presenter notes survive \u2192 both editions.\n\nReview approval and timing.";
  const source = hosted.exportBundle(workspace, bundle.project.id, [...bundle.flows, architecture]);
  const localCopy = prepareBundleImport(workspace, source);
  const exported = exportBundle(localCopy.workspace, localCopy.result.project.id, localCopy.flows);
  assert.doesNotThrow(() => hosted.validateBundle(exported));
  const restored = hosted.prepareBundleImport(workspace, exported);
  assert.deepEqual(restored.flows.map(flow => flow.name), source.flows.map(flow => flow.name));
  source.flows.forEach((original, index) => {
    const result = restored.flows[index];
    assert.deepEqual(result.groups, original.groups);
    assert.deepEqual(result.edges, original.edges);
    assert.equal(result.diagramType, original.diagramType);
    assert.equal(result.presentationNotes, original.presentationNotes);
    assert.deepEqual(result.nodes.map(({ subflowId: _link, ...node }) => node), original.nodes.map(({ subflowId: _link, ...node }) => node));
  });
  assert.equal(restored.flows[0].nodes.find(node => node.id === "work")!.subflowId, restored.flows[1].id);
  const originalProject = source.project.roadmap, resultProject = restored.workspace.projects.at(-1)!.roadmap;
  assert.deepEqual(resultProject.tasks.map(task => ({ status: task.status, decision: task.decision, condition: task.condition?.answer, assignees: task.assigneeIds?.length ?? 0 })), originalProject.tasks.map(task => ({ status: task.status, decision: task.decision, condition: task.condition?.answer, assignees: task.assigneeIds?.length ?? 0 })));
  assert.notEqual(restored.result.project.id, source.project.id);
  assert.deepEqual(workspace, originalWorkspace, "the source workspace is unchanged");
});

test("both editions reject credentials and unsupported fields while reading older workflow bundles", () => {
  const { bundle } = transferFixture();
  for (const reader of [validateBundle, hosted.validateBundle]) {
    assert.doesNotThrow(() => reader(bundle));
    assert.throws(() => reader({ ...bundle, apiKey: "never-export-credentials" }));
    assert.throws(() => reader({ ...bundle, sessions: [] }));
    assert.throws(() => reader({ ...bundle, flows: [{ ...bundle.flows[0], unsupportedFutureField: true }] }));
  }
});
