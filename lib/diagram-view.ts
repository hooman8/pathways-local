import { diagramTypeOf, type DiagramType, type FlowSummary } from "./application-flow";

export function diagramsInView(flows: FlowSummary[], projectId: string | null, type: DiagramType) {
  return flows.filter(flow => flow.projectId === projectId && diagramTypeOf(flow) === type);
}

export function diagramUrl(projectId: string | null, type: DiagramType, id?: string) {
  const params = new URLSearchParams({ project: projectId ?? "" });
  if (id) params.set("flow", id);
  return `${type === "architecture" ? "/architecture" : "/flows"}?${params}`;
}

// Each view rearranges its own slots in the shared project order. Other diagrams
// keep their positions, and the API still checks the complete list for conflicts.
export function projectOrderForView(flows: FlowSummary[], projectId: string | null, type: DiagramType, order: string[]) {
  const visible = diagramsInView(flows, projectId, type), ids = new Set(visible.map(flow => flow.id));
  if (order.length !== ids.size || new Set(order).size !== ids.size || order.some(id => !ids.has(id))) throw new Error("Include every diagram in this view exactly once.");
  let index = 0;
  return flows.filter(flow => flow.projectId === projectId).map(flow => diagramTypeOf(flow) === type ? order[index++] : flow.id);
}
