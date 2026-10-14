import { exampleFlow } from "./flow-fixture";

export function agentDraft() {
  const flow = exampleFlow();
  return { summary: "Create linked overview and detail.", assumptions: [], flows: [
    { ...flow, id: "overview", projectId: undefined, version: undefined, presentationNotes: "Explain approval, timing, bounded retries and the linked detail.", nodes: flow.nodes.map(node => node.id === "work" ? { ...node, kind: "subflow", subflowId: "detail" } : node) },
    { ...flow, id: "detail", projectId: undefined, version: undefined, presentationNotes: "Explain the detailed request outcomes." },
  ].map(({ projectId: _project, version: _version, ...portable }) => portable), flowOrder: ["overview", "detail"] };
}
