import test from "node:test";
import assert from "node:assert/strict";
import { inspectFlow } from "../lib/application-flow";
import { exampleFlow } from "./flow-fixture";
import { layoutFlow } from "../lib/flow-layout";

test("flows accept labeled outcomes, deadlines, and bounded recovery paths", () => {
  const flow = exampleFlow();
  assert.equal(inspectFlow(flow).valid, true);
  assert.deepEqual(flow.notes, []);
  assert.deepEqual(flow.nodes[0].checks, []);
});

test("flow validation rejects ambiguous, disconnected, or unbounded paths", () => {
  const cases = [
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges[0].target = "missing"; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.nodes[1].id = "start"; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges[1].label = ""; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges[2].label = "YES"; },
    (flow: ReturnType<typeof exampleFlow>) => { delete flow.nodes[2].timer; },
    (flow: ReturnType<typeof exampleFlow>) => { delete flow.edges[6].retry; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges[6].kind = "next"; delete flow.edges[6].retry; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges[6].target = "end"; },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges = flow.edges.filter(edge => edge.target !== "wait"); },
    (flow: ReturnType<typeof exampleFlow>) => { flow.edges = flow.edges.filter(edge => edge.source !== "retry" || edge.kind === "retry"); },
  ];
  for (const [index, mutate] of cases.entries()) {
    const flow = exampleFlow(); mutate(flow);
    const report = inspectFlow(flow);
    assert.equal(report.valid, false, `invalid case ${index} must fail`);
    assert.ok(report.issues.length);
  }
});

test("subflow links cannot target their own definition and unknown fields fail", () => {
  const flow = exampleFlow();
  flow.nodes[3].kind = "subflow"; flow.nodes[3].subflowId = flow.id;
  assert.equal(inspectFlow(flow).valid, false);
  delete flow.nodes[3].subflowId;
  assert.equal(inspectFlow(flow).valid, true);
  assert.ok(inspectFlow(flow).warnings.length);
  assert.equal(inspectFlow({ ...flow, execute: true }).valid, false);
});

test("layout supplies finite routed geometry for branches and retries", async () => {
  const flow = exampleFlow(), layout = await layoutFlow(flow);
  assert.equal(layout.nodes.length, flow.nodes.length);
  assert.equal(layout.edges.length, flow.edges.length);
  for (const node of layout.nodes) assert.ok([node.x, node.y, node.inputX, node.outputX].every(Number.isFinite));
  for (const edge of layout.edges) {
    assert.ok(edge.points.length >= 2, edge.id);
    for (const point of edge.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});
