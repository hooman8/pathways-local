import test from "node:test";
import assert from "node:assert/strict";
import { createProject, migrateRoadmap, saveProjectTemplate, validateWorkspace, parseProjectImport, mergeProjectImport, updateTeam } from "../lib/projects";
import { mergeWorkspaces } from "../lib/shared";
import { decisionRoadmap } from "./decision-fixture";

function sourceWorkspace() {
  const workspace = migrateRoadmap(decisionRoadmap());
  workspace.engineers = [{ id: "engineer", name: "Example Engineer", team: "" }];
  workspace.teams = [{ id: "delivery", name: "Delivery", engineerIds: ["engineer"] }];
  const project = workspace.projects[0];
  project.engineerIds = ["engineer"];
  project.roadmap.application = "Source application";
  project.roadmap.tasks.forEach(t => { t.owner = "Delivery"; t.teamId = "delivery"; t.assigneeIds = ["engineer"]; t.description = "Instructions"; t.criteria = ["Completion criterion"]; });
  project.roadmap.tasks.find(t => t.id === "review")!.status = "done";
  const decision = project.roadmap.tasks.find(t => t.decision)!;
  decision.decision!.answer = "yes"; decision.status = "done";
  project.roadmap.tasks.find(t => t.id === "create-db")!.status = "done";
  Object.assign(project.roadmap.tasks.find(t => t.id === "configure-db")!, { status: "blocked", blockedReason: "Waiting for access" });
  project.roadmap.tasks.find(t => t.id === "continue")!.status = "skipped";
  return validateWorkspace(workspace);
}

test("project templates preserve the workflow but clear all run-specific state", () => {
  const source = sourceWorkspace(), before = structuredClone(source);
  const next = saveProjectTemplate(source, source.activeProjectId, "Database onboarding", "For applications with storage");
  assert.deepEqual(source, before);
  assert.deepEqual(next.projects, source.projects);
  const template = next.templates[0];
  assert.equal(template.sourceProjectName, "Source application");
  const tasks = template.roadmap.tasks;
  assert.ok(tasks.every(t => t.status === "todo" && !t.blockedReason && !t.assigneeIds?.length && !t.decision?.answer));
  assert.ok(tasks.every(t => t.teamId === "delivery" && t.owner === "Delivery"));
  assert.ok(tasks.every(t => !source.projects[0].roadmap.tasks.some(old => old.id === t.id)));
  assert.deepEqual(tasks.map(t => [t.title, t.description, t.criteria]), source.projects[0].roadmap.tasks.map(t => [t.title, t.description, t.criteria]));
  const decision = tasks.find(t => t.decision)!;
  const group = tasks.find(t => t.condition)!;
  assert.equal(group.condition!.decisionId, decision.id);
  assert.ok(tasks.some(t => t.parentId === group.id));
  assert.ok(tasks.some(t => t.dependsOn.includes(group.id)));
  const first = createProject(template.roadmap, "First new app", template.roadmap.title, ["engineer"]);
  const second = createProject(template.roadmap, "Second new app", template.roadmap.title);
  first.roadmap.tasks[0].title = "Project-specific edit";
  next.projects[0].roadmap.tasks[0].title = "Source project edit";
  assert.equal(template.roadmap.tasks[0].title, "review");
  assert.equal(second.roadmap.tasks[0].title, "review");
  assert.ok(first.roadmap.tasks.every(t => !second.roadmap.tasks.some(other => other.id === t.id) && !tasks.some(other => other.id === t.id)));
  assert.deepEqual(first.engineerIds, ["engineer"]);
  assert.ok(first.roadmap.tasks.every(t => !t.assigneeIds?.length));
});

test("template names are unique, old workspaces upgrade, and invalid templates are rejected", () => {
  const source = sourceWorkspace();
  const { templates: _templates, ...old } = source;
  assert.deepEqual(validateWorkspace(old).templates, []);
  const saved = saveProjectTemplate(source, source.activeProjectId, "Database");
  assert.throws(() => saveProjectTemplate(saved, saved.activeProjectId, " database "), /already exists/);
  assert.throws(() => saveProjectTemplate(saved, saved.activeProjectId, " "), /name/);
  assert.throws(() => saveProjectTemplate(saved, "missing", "Another"), /no longer exists/);
  const invalid = structuredClone(saved);
  invalid.templates[0].roadmap.tasks[0].status = "done";
  assert.throws(() => validateWorkspace(invalid), /fresh progress/);
  invalid.templates[0].roadmap.tasks[0].status = "todo";
  invalid.templates[0].roadmap.tasks[0].teamId = "missing";
  assert.throws(() => validateWorkspace(invalid), /responsible team/);
});

test("named templates survive backup imports, team renames, and project independence", () => {
  const source = sourceWorkspace();
  const saved = saveProjectTemplate(source, source.activeProjectId, "Database");
  const parsed = parseProjectImport(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(parsed.templates, saved.templates);
  const imported = mergeProjectImport(saved, parsed);
  assert.equal(imported.templates.length, 2);
  assert.equal(imported.templates[1].name, "Database (imported 1)");
  assert.notEqual(imported.templates[0].id, imported.templates[1].id);
  const renamed = updateTeam(imported, { ...imported.teams[0], name: "Delivery team" });
  assert.ok(renamed.templates.every(t => t.roadmap.tasks.every(task => task.owner === "Delivery team")));
  assert.equal(renamed.templates[0].roadmap.tasks[0].teamId, "delivery");
});

test("concurrent template creation merges with projects and other uniquely named templates", () => {
  const base = sourceWorkspace();
  const mine = saveProjectTemplate(base, base.activeProjectId, "Database");
  const shared = saveProjectTemplate(base, base.activeProjectId, "Storage");
  shared.projects[0].roadmap.title = "Changed separately";
  const merged = mergeWorkspaces(base, mine, shared);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.workspace.templates.length, 2);
  assert.equal(merged.workspace.projects[0].roadmap.title, "Changed separately");
  const duplicate = saveProjectTemplate(base, base.activeProjectId, "Database");
  assert.ok(mergeWorkspaces(base, mine, duplicate).conflicts.length);
});
