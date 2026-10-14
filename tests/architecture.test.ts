import test from "node:test";
import assert from "node:assert/strict";
import { architectureStarter, componentKinds, inspectFlow, diagramTypeOf, type FlowSummary } from "../lib/application-flow";
import { layoutFlow } from "../lib/flow-layout";
import { segmentCrossesCard } from "../lib/connector-routing";
import { exportBundle, prepareBundleImport } from "../lib/project-bundle";
import { migrateRoadmap } from "../lib/projects";
import { exampleFlow } from "./flow-fixture";
import { architectureFixture } from "./architecture-fixture";
import { COMPONENT_WIDTH, COMPONENT_HEIGHT } from "../lib/architecture-layout";
import { normalizeAiProposal } from "../lib/ai-authoring";
import { diagramUrl, diagramsInView, projectOrderForView } from "../lib/diagram-view";
import { runAuthoring, type AuthoringContent } from "../lib/authoring-runner";
import type { AiSession } from "../lib/ai-authoring";

test("architecture diagrams model grouped components and real two-way relationships without workflow terminal nodes", () => {
  const flow = architectureFixture();
  assert.equal(inspectFlow(flow).valid, true);
  assert.equal(flow.nodes.some(node => node.kind === "start" || node.kind === "end"), false);
  assert.equal(flow.edges.find(edge => edge.id === "sync")?.direction, "both");
  // A connected architecture can describe a feedback relationship without a fake retry limit.
  flow.edges.push({ id: "feedback", source: "display-files", target: "browser", kind: "next", label: "Feedback" });
  assert.equal(inspectFlow(flow).valid, true);
});

test("architecture validation rejects missing groups, bad references, duplicate groups and isolated components", () => {
  const cases = [
    (flow: ReturnType<typeof architectureFixture>) => { delete flow.groups; },
    (flow: ReturnType<typeof architectureFixture>) => { flow.groups!.push({ ...flow.groups![0] }); },
    (flow: ReturnType<typeof architectureFixture>) => { flow.nodes[0].groupId = "unknown"; },
    (flow: ReturnType<typeof architectureFixture>) => { flow.groups!.push({ id: "empty", title: "Empty", description: "" }); },
    (flow: ReturnType<typeof architectureFixture>) => { flow.edges = flow.edges.filter(edge => edge.source !== "editor"); },
    (flow: ReturnType<typeof architectureFixture>) => { flow.edges[0].target = "missing"; },
    (flow: ReturnType<typeof architectureFixture>) => { flow.edges[0].kind = "retry"; flow.edges[0].retry = { maxAttempts: 3, backoff: "Wait" }; },
  ];
  for (const [index, mutate] of cases.entries()) {
    const flow = architectureFixture(); mutate(flow);
    assert.equal(inspectFlow(flow).valid, false, `invalid architecture ${index}`);
  }
  const workflow = exampleFlow();
  workflow.edges[0].direction = "both";
  assert.equal(inspectFlow(workflow).valid, false, "workflow dependency semantics must stay directional");
});

test("architecture layout separates device groups and keeps every connector and label clear of components", async () => {
  const flow = architectureFixture(), layout = await layoutFlow(flow);
  assert.equal(layout.groups?.length, 2);
  const [laptop, display] = layout.groups!;
  assert.ok(laptop.x + laptop.width < display.x);
  const rectangles = layout.nodes.map(node => ({ ...node, width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT }));
  for (const node of layout.nodes) {
    const group = layout.groups!.find(group => group.id === node.groupId)!;
    assert.ok(node.x >= group.x && node.x + COMPONENT_WIDTH <= group.x + group.width);
    assert.ok(node.y >= group.y && node.y + COMPONENT_HEIGHT <= group.y + group.height);
  }
  for (const route of layout.edges) {
    const definition = flow.edges.find(edge => edge.id === route.id)!;
    const obstacles = rectangles.filter(node => node.id !== definition.source && node.id !== definition.target);
    for (let i = 1; i < route.points.length; i++) {
      assert.ok(obstacles.every(rect => !segmentCrossesCard(route.points[i - 1], route.points[i], rect)), `clear connector ${route.id}`);
    }
    if (route.labelPosition) {
      const p = route.labelPosition, width = definition.label.length * 9 + 24;
      assert.ok(rectangles.every(rect => p.x + width / 2 <= rect.x || p.x - width / 2 >= rect.x + rect.width || p.y + 18 <= rect.y || p.y - 18 >= rect.y + rect.height), `clear label ${route.id}`);
    }
  }
});

test("complete project round trips preserve architecture groups, directions, presenter notes and detail links", () => {
  const workspace = migrateRoadmap({ version: 1, title: "Architecture", application: "Example", tasks: [] });
  const flow = { ...architectureFixture(), projectId: workspace.activeProjectId };
  const detail = { ...exampleFlow(), id: "detail", projectId: workspace.activeProjectId };
  flow.nodes[2].kind = "subflow"; flow.nodes[2].subflowId = "detail";
  const result = prepareBundleImport(workspace, exportBundle(workspace, workspace.activeProjectId, [flow, detail]));
  const copied = result.flows[0];
  assert.deepEqual(copied.groups, flow.groups);
  assert.deepEqual(copied.edges, flow.edges);
  assert.equal(copied.diagramType, "architecture");
  assert.equal(copied.presentationNotes, flow.presentationNotes);
  assert.equal(copied.nodes[2].subflowId, result.flows[1].id);
});

test("AI proposals preserve architecture metadata while remapping symbolic diagram links", () => {
  const { version, projectId, ...draft } = architectureFixture();
  assert.equal(version, 1); assert.equal(projectId, null);
  const proposal = normalizeAiProposal({ summary: "Grouped systems", assumptions: [], flows: [draft], flowOrder: [draft.id] }, { projectId: "project", projectName: "Example", flows: [] });
  assert.equal(proposal.flows[0].diagramType, "architecture");
  assert.deepEqual(proposal.flows[0].groups, draft.groups);
  assert.equal(proposal.flows[0].edges.find(edge => edge.id === "sync")?.direction, "both");
});

test("component kinds describe app architecture without weakening workflow validation", () => {
  for (const kind of componentKinds) {
    const architecture = architectureStarter("project");
    architecture.nodes[0].kind = kind;
    assert.equal(inspectFlow(architecture).valid, true);
    const workflow = exampleFlow(); workflow.nodes.find(node => node.kind === "process")!.kind = kind;
    assert.equal(inspectFlow(workflow).valid, false);
  }
  assert.equal(diagramTypeOf(exampleFlow()), "workflow", "legacy files are still workflows");
});

test("architecture connections sharing an API keep their labels distinct", async () => {
  const flow = architectureStarter("project");
  flow.nodes.push({ id: "cache", kind: "cache", title: "Redis cache", actor: "Cache service", description: "Caches API reads.", checks: [], phase: "", groupId: "server" });
  flow.edges.push({ id: "api-cache", source: "api", target: "cache", kind: "next", direction: "both", label: "Cache reads / writes" });
  const layout = await layoutFlow(flow);
  const labels = layout.edges.filter(edge => edge.labelPosition).map(edge => {
    const definition = flow.edges.find(item => item.id === edge.id)!;
    return { ...edge.labelPosition!, width: definition.label.length * 9 + 24, height: 36 };
  });
  for (const [index, label] of labels.entries()) {
    assert.ok(labels.slice(index + 1).every(other => Math.abs(label.x - other.x) >= (label.width + other.width) / 2 || Math.abs(label.y - other.y) >= (label.height + other.height) / 2));
  }
});

function mixedSummaries(): FlowSummary[] {
  return [
    { id: "work-a", projectId: "project" },
    { id: "arch-a", projectId: "project", diagramType: "architecture" },
    { id: "work-b", projectId: "project", diagramType: "workflow" },
    { id: "arch-b", projectId: "project", diagramType: "architecture" },
    { id: "other", projectId: "elsewhere", diagramType: "architecture" },
    { id: "unassigned", projectId: null, diagramType: "architecture" },
  ].map(flow => ({ name: flow.id, description: "", revision: 1, updatedAt: "now", nodes: 3, edges: 2, ...flow }) as FlowSummary);
}

test("diagram libraries and reordering keep project scopes and the other view's slots intact", () => {
  const all = mixedSummaries();
  assert.deepEqual(diagramsInView(all, "project", "architecture").map(flow => flow.id), ["arch-a", "arch-b"]);
  assert.deepEqual(diagramsInView(all, "project", "workflow").map(flow => flow.id), ["work-a", "work-b"]);
  assert.deepEqual(diagramsInView(all, null, "architecture").map(flow => flow.id), ["unassigned"]);
  assert.deepEqual(projectOrderForView(all, "project", "architecture", ["arch-b", "arch-a"]), ["work-a", "arch-b", "work-b", "arch-a"]);
  assert.deepEqual(projectOrderForView(all, "project", "workflow", ["work-b", "work-a"]), ["work-b", "arch-a", "work-a", "arch-b"]);
  for (const order of [["arch-a"], ["arch-a", "arch-a"], ["arch-a", "other"]]) assert.throws(() => projectOrderForView(all, "project", "architecture", order), /every diagram/);
  assert.equal(diagramUrl("project / one", "architecture", "diagram one"), "/architecture?project=project+%2F+one&flow=diagram+one");
  assert.equal(diagramUrl(null, "workflow"), "/flows?project=");
});

test("architecture proposals keep workflows unchanged and cannot convert existing diagrams", () => {
  const original = { ...exampleFlow(), projectId: "project" };
  const context = { projectId: "project", projectName: "Example", diagramType: "architecture" as const, flows: [{ flow: original, revision: 1, updatedAt: "now" }] };
  const { version, projectId, ...architecture } = architectureFixture();
  assert.equal(version, 1); assert.equal(projectId, null);
  const draft = { summary: "Add architecture", assumptions: [], flows: [architecture], flowOrder: [original.id, architecture.id] };
  const proposal = normalizeAiProposal(draft, context);
  assert.equal(proposal.flowOrder[0], original.id);
  assert.equal(proposal.flows.length, 1);
  assert.equal(proposal.flows[0].diagramType, "architecture");
  assert.throws(() => normalizeAiProposal({ ...draft, flowOrder: [architecture.id, original.id] }, context), /existing positions/);
  const { version: oldVersion, projectId: oldProject, ...workflow } = original;
  assert.equal(oldVersion, 1); assert.equal(oldProject, "project");
  assert.throws(() => normalizeAiProposal({ ...draft, flows: [workflow] }, context), /only propose architecture/);
  assert.throws(() => normalizeAiProposal(draft, { ...context, diagramType: "workflow" }), /only propose workflow/);
  assert.throws(() => normalizeAiProposal({ ...draft, flows: [{ ...architecture, id: original.id }], flowOrder: [original.id] }, context), /cannot convert/);
});

test("AI repairs an out-of-view proposal before offering an architecture draft for review", async () => {
  const context = { projectId: "project", projectName: "Example", diagramType: "architecture" as const, flows: [] };
  const session: AiSession = { id: "session", userId: "owner", projectId: "project", projectName: "Example", diagramType: "architecture", model: "fixture", revision: 1, status: "generating", messages: [{ role: "user", content: "Design my app" }], proposal: null, questions: [], error: null, trace: [], base: [], lastRequestId: null, startedAt: 0, updatedAt: 0 };
  let calls = 0;
  const result = await runAuthoring(context, session, async contents => {
    const { version, projectId, ...flow } = ++calls === 1 ? exampleFlow() : architectureFixture();
    assert.equal(version, 1); assert.equal(projectId, null);
    if (calls === 1) assert.match(contents[0].parts[0].text!, /"authoringDiagramType":"architecture"/);
    else assert.match(JSON.stringify(contents.at(-1)), /only propose architecture/);
    if (calls > 1) flow.nodes = flow.nodes.map(node => ({ ...node, description: `Responsibility of ${node.title}.`, checks: ["The documented interface is available to its connected components."] }));
    return { role: "model", parts: [{ functionCall: { name: "propose_changes", args: { summary: "Architecture design", assumptions: [], flows: [flow], flowOrder: [flow.id] } } }] } as AuthoringContent;
  }, new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(result.proposal?.flows[0].diagramType, "architecture");
  assert.ok(result.trace.includes("Returned validation feedback to the model"));
});
