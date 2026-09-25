import { z } from "zod";

export const flowKinds = ["start", "human", "process", "decision", "api", "database", "timer", "subflow", "end"] as const;
export const edgeKinds = ["next", "branch", "error", "retry"] as const;
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use letters, numbers, underscores, or hyphens for IDs.");
export const flowNodeSchema = z.object({
  id, kind: z.enum(flowKinds), title: z.string().trim().min(1).max(120),
  actor: z.string().trim().max(100).default(""),
  description: z.string().max(6000).default(""),
  checks: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  phase: z.string().trim().max(100).default(""),
  timer: z.object({ mode: z.enum(["deadline", "duration", "schedule"]), expression: z.string().trim().min(1).max(500) }).strict().optional(),
  subflowId: id.optional(),
}).strict();
export const flowEdgeSchema = z.object({
  id, source: id, target: id, label: z.string().trim().max(120).default(""),
  kind: z.enum(edgeKinds).default("next"),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(100), backoff: z.string().trim().min(1).max(300) }).strict().optional(),
}).strict();
export const applicationFlowSchema = z.object({
  version: z.literal(1), id, name: z.string().trim().min(1).max(120),
  projectId: z.string().min(1).max(100).nullable().default(null),
  description: z.string().max(6000).default(""),
  notes: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  nodes: z.array(flowNodeSchema).min(2).max(250),
  edges: z.array(flowEdgeSchema).min(1).max(600),
}).strict();
export type ApplicationFlow = z.infer<typeof applicationFlowSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowIssue = { path: string; message: string };
export type FlowSnapshot = { flow: ApplicationFlow; revision: number; updatedAt: string };
export type FlowSummary = { id: string; projectId: string | null; name: string; description: string; revision: number; updatedAt: string; nodes: number; edges: number };
export type FlowProject = { id: string; name: string; flowCount: number };

export function inspectFlow(input: unknown): { valid: boolean; issues: FlowIssue[]; warnings: string[]; flow?: ApplicationFlow } {
  const parsed = applicationFlowSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })), warnings: [] };
  const flow = parsed.data, issues: FlowIssue[] = [], warnings: string[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  const nodes = new Map(flow.nodes.map(node => [node.id, node]));
  if (nodes.size !== flow.nodes.length) issue("nodes", "Each node needs a unique ID.");
  if (new Set(flow.edges.map(edge => edge.id)).size !== flow.edges.length) issue("edges", "Each connection needs a unique ID.");
  const starts = flow.nodes.filter(node => node.kind === "start");
  if (starts.length !== 1) issue("nodes", "A flow needs exactly one start node.");
  const ends = flow.nodes.filter(node => node.kind === "end");
  if (!ends.length) issue("nodes", "Add at least one end node.");
  const validEdges = flow.edges.filter(edge => nodes.has(edge.source) && nodes.has(edge.target));
  flow.edges.forEach((edge, index) => {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) issue(`edges.${index}`, "Both connection endpoints must exist.");
    if (edge.source === edge.target) issue(`edges.${index}`, "Use a separate retry or wait step instead of a self-loop.");
    if ((edge.kind === "branch" || edge.kind === "error" || edge.kind === "retry") && !edge.label) issue(`edges.${index}.label`, "Label this branch, error, or retry connection.");
    if (edge.kind === "retry" && !edge.retry) issue(`edges.${index}.retry`, "A retry needs an attempt limit and backoff description.");
    if (edge.kind !== "retry" && edge.retry) issue(`edges.${index}.retry`, "Only retry connections can carry retry settings.");
  });
  flow.nodes.forEach((node, index) => {
    const outgoing = validEdges.filter(edge => edge.source === node.id), incoming = validEdges.filter(edge => edge.target === node.id);
    if (node.kind === "start" && incoming.length) issue(`nodes.${index}`, "The start node cannot have incoming connections.");
    if (node.kind === "end" && outgoing.length) issue(`nodes.${index}`, "End nodes cannot have outgoing connections.");
    if (node.kind !== "end" && !outgoing.length) issue(`nodes.${index}`, "Connect this step to a following step or an end node.");
    if (node.kind === "decision") {
      if (outgoing.length < 2 || outgoing.some(edge => !edge.label)) issue(`nodes.${index}`, "Decisions need at least two labeled outcomes.");
      if (new Set(outgoing.map(edge => edge.label.toLowerCase())).size !== outgoing.length) issue(`nodes.${index}`, "Decision outcomes must have distinct labels.");
    }
    if (node.kind === "timer" && !node.timer) issue(`nodes.${index}.timer`, "Describe when the timer becomes due.");
    if (node.kind !== "timer" && node.timer) issue(`nodes.${index}.timer`, "Only timer nodes can carry timer settings.");
    if (node.kind !== "subflow" && node.subflowId) issue(`nodes.${index}.subflowId`, "Only subflow nodes can link another flow.");
    if (node.subflowId === flow.id) issue(`nodes.${index}.subflowId`, "A flow cannot link to itself as a subflow.");
  });
  const forward = validEdges.filter(edge => edge.kind !== "retry");
  const walk = (seeds: string[], edges: FlowEdge[], reverse = false) => {
    const visited = new Set(seeds), queue = [...seeds];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of edges) {
        const from = reverse ? edge.target : edge.source, to = reverse ? edge.source : edge.target;
        if (from === current && !visited.has(to)) { visited.add(to); queue.push(to); }
      }
    }
    return visited;
  };
  const visiting = new Set<string>(), visited = new Set<string>();
  function cyclic(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const edge of forward.filter(edge => edge.source === node)) if (cyclic(edge.target)) return true;
    visiting.delete(node); visited.add(node); return false;
  }
  if (flow.nodes.some(node => cyclic(node.id))) issue("edges", "A cycle must use an explicit, bounded retry connection.");
  if (starts.length === 1) {
    const reachable = walk([starts[0].id], forward), finishing = walk(ends.map(node => node.id), forward, true);
    flow.nodes.forEach((node, index) => {
      if (!reachable.has(node.id)) issue(`nodes.${index}`, "This node is not reachable from the start without taking a retry.");
      if (!finishing.has(node.id)) issue(`nodes.${index}`, "This node has no non-retry path to an end.");
    });
    validEdges.filter(edge => edge.kind === "retry").forEach(edge => {
      if (!walk([edge.target], forward).has(edge.source)) issue(`edges.${flow.edges.indexOf(edge)}`, "A retry must return to an earlier step on its path.");
    });
  }
  if (flow.nodes.some(node => node.kind === "subflow" && !node.subflowId)) warnings.push("Some subflow steps do not link to a saved detail flow yet.");
  if (flow.nodes.length > 60) warnings.push("Consider linked subflows to keep this diagram readable.");
  return { valid: issues.length === 0, issues, warnings, flow };
}

export function validateFlow(input: unknown): ApplicationFlow {
  const report = inspectFlow(input);
  if (!report.valid || !report.flow) throw new Error(report.issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
  return report.flow;
}
