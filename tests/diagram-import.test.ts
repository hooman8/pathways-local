import test from "node:test";
import assert from "node:assert/strict";
import { prepareDiagramImport } from "../lib/diagram-import";
import { architectureFixture } from "./architecture-fixture";
import { exampleFlow } from "./flow-fixture";
import type { FlowSnapshot } from "../lib/application-flow";

test("replacement imports retain the destination identity and project while updating portable content", () => {
  const imported = { ...architectureFixture(), projectId: "local-project", description: "Updated architecture", presentationNotes: "Updated notes" };
  const existing: FlowSnapshot = { flow: { ...architectureFixture(), projectId: "private-project" }, revision: 7, updatedAt: "2026-01-01" };
  const before = structuredClone(existing);
  const replacement = prepareDiagramImport(imported, { mode: "replace", existing });
  assert.deepEqual(replacement, { ...imported, projectId: "private-project" });
  assert.deepEqual(existing, before, "the reviewed snapshot and revision remain unchanged for the conditional save");
  assert.equal(imported.projectId, "local-project");
  existing.flow.projectId = null;
  assert.equal(prepareDiagramImport(imported, { mode: "replace", existing }).projectId, null);
});

test("replacement imports reject a changed identity or a different diagram type", () => {
  const existing: FlowSnapshot = { flow: architectureFixture(), revision: 1, updatedAt: "2026-01-01" };
  assert.throws(() => prepareDiagramImport({ ...existing.flow, id: "different" }, { mode: "replace", existing }), /existing diagram ID/);
  assert.throws(() => prepareDiagramImport({ ...exampleFlow(), id: existing.flow.id }, { mode: "replace", existing }), /same diagram type/);
});

test("new and copied diagrams use the selected project and preserve architecture metadata", () => {
  const imported = { ...architectureFixture(), projectId: "other-installation" };
  assert.deepEqual(prepareDiagramImport(imported, { mode: "new", projectId: "selected" }), { ...imported, projectId: "selected" });
  const copy = prepareDiagramImport(imported, { mode: "copy", projectId: null, id: "new-copy" });
  assert.deepEqual(copy, { ...imported, id: "new-copy", projectId: null });
  assert.notEqual(copy.id, imported.id);
});

test("legacy workflow imports can replace their saved workflow without architecture fields", () => {
  const existing: FlowSnapshot = { flow: exampleFlow(), revision: 3, updatedAt: "2026-01-01" };
  const incoming = { ...existing.flow, name: "Updated workflow" };
  assert.equal(prepareDiagramImport(incoming, { mode: "replace", existing }).name, incoming.name);
});
