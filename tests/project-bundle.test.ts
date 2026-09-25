import test from "node:test";
import assert from "node:assert/strict";
import { exportBundle, validateBundle, prepareBundleImport, bundleWarnings } from "../lib/project-bundle";
import { transferFixture } from "./bundle-fixture";
test("complete project roundtrip remaps identities and links while preserving order and existing projects", () => {
  const { workspace, bundle } = transferFixture(), before = structuredClone(workspace);
  const imported = prepareBundleImport(workspace, bundle);
  assert.deepEqual(workspace, before);
  assert.deepEqual(imported.workspace.projects[0], workspace.projects[0]);
  assert.notEqual(imported.result.project.id, bundle.project.id);
  assert.match(imported.result.project.name, /imported 2/);
  assert.deepEqual(imported.flows.map(flow => flow.name), bundle.flowOrder.map(id => bundle.flows.find(flow => flow.id === id)!.name));
  assert.ok(imported.flows.every(flow => flow.projectId === imported.result.project.id && !bundle.flowOrder.includes(flow.id)));
  assert.equal(imported.flows[0].nodes.find(node => node.id === "work")!.subflowId, imported.flows[1].id);
  const second = prepareBundleImport(imported.workspace, exportBundle(imported.workspace, imported.result.project.id, imported.flows));
  assert.equal(second.flows[0].nodes.find(node => node.id === "work")!.subflowId, second.flows[1].id);
  assert.deepEqual(second.flows[0].edges, bundle.flows[0].edges);
  assert.deepEqual(second.workspace.projects.at(-1)!.roadmap.tasks.map(task => task.status), bundle.project.roadmap.tasks.map(task => task.status));
});
test("bundle validation rejects foreign flows, ambiguous ordering, invalid graphs, and access metadata", () => {
  const { bundle } = transferFixture();
  for (const invalid of [ { ...bundle, version: 2 }, { ...bundle, members: [] }, { ...bundle, flowOrder: ["overview", "overview"] }, { ...bundle, flowOrder: ["overview"] }, { ...bundle, flows: bundle.flows.map(flow => ({ ...flow, projectId: "foreign" })) }, { ...bundle, flows: bundle.flows.map(flow => ({ ...flow, edges: [] })) } ]) assert.throws(() => validateBundle(invalid));
});
test("external detail links are disclosed and detached instead of binding to unrelated destination flows", () => {
  const { workspace, bundle } = transferFixture();
  bundle.flows[0].nodes.find(node => node.id === "work")!.subflowId = "external";
  assert.equal(bundleWarnings(bundle).length, 1);
  const imported = prepareBundleImport(workspace, bundle);
  assert.equal(imported.flows[0].nodes.find(node => node.id === "work")!.subflowId, undefined);
  assert.equal(imported.flows[0].nodes.find(node => node.id === "work")!.kind, "subflow");
  assert.equal(imported.result.warnings.length, 1);
});
