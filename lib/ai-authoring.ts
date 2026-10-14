import { z } from "zod";
import { applicationFlowSchema, diagramTypeOf, inspectFlow, type ApplicationFlow, type DiagramType, type FlowSnapshot } from "./application-flow";

export const AI_MAX_CONTEXT_BYTES = 250_000;
export const AI_MAX_PROPOSAL_BYTES = 350_000;
const text = z.string().trim().min(1).max(4000);
export const aiProposalSchema = z.object({
  summary: text,
  assumptions: z.array(text).max(12),
  flows: z.array(applicationFlowSchema.omit({ projectId: true, version: true })).min(1).max(12),
  flowOrder: z.array(z.string().min(1).max(100)).max(100),
}).strict();
export const aiQuestionsSchema = z.object({ message: text, questions: z.array(text).min(1).max(3) }).strict();
export type AiContext = { projectId: string; projectName: string; flows: FlowSnapshot[]; diagramType?: DiagramType };
export type AiProposal = {
  id: string; summary: string; assumptions: string[]; warnings: string[];
  flows: ApplicationFlow[]; flowOrder: string[];
  changes: { id: string; name: string; kind: "create" | "update"; addedSteps: string[]; removedSteps: string[]; changedSteps: string[]; connectionsBefore: number; connectionsAfter: number }[];
};
export type AiSession = {
  id: string; userId: string; projectId: string; projectName: string; model: string;
  provider?: AiProvider;
  diagramType?: DiagramType;
  revision: number; status: "idle" | "generating" | "ready" | "questions" | "failed" | "applied";
  messages: { role: "user" | "assistant"; content: string }[];
  proposal: AiProposal | null; questions: string[]; error: string | null; trace: string[];
  base: { id: string; revision: number }[];
  lastRequestId: string | null; startedAt: number; updatedAt: number;
  generationExpiresAt?: number;
};
export type AiProvider = "openai" | "agent";
export type AiProviderOption = { id: AiProvider; label: string; model: string; enabled: boolean };
export const sessionProvider = (session: Pick<AiSession, "provider">): AiProvider => session.provider ?? "openai";
export const providerLabel = (provider: AiProvider) => provider === "openai" ? "Astra" : "Local agent";
export function assertAiDiagramScope(flows: { id: string; diagramType?: DiagramType }[], context: AiContext) {
  for (const flow of flows) {
    if (context.diagramType && diagramTypeOf(flow) !== context.diagramType) throw new Error(`This ${context.diagramType} conversation can only propose ${context.diagramType} diagrams. Keep other diagrams unchanged in flowOrder.`);
    const prior = context.flows.find(item => item.flow.id === flow.id);
    if (prior && diagramTypeOf(flow) !== diagramTypeOf(prior.flow)) throw new Error("AI cannot convert an existing diagram to another type. Create a new diagram instead.");
  }
}
export function assertAiDiagramOrder(order: string[], context: AiContext) {
  if (!context.diagramType) return;
  context.flows.forEach(({ flow }, index) => {
    if (diagramTypeOf(flow) !== context.diagramType && order[index] !== flow.id) throw new Error("Keep diagrams from the other view in their existing positions in flowOrder. Append new diagrams after the saved list.");
  });
}
// AI drafts need reviewable detail; keep the portable/manual flow schema compatible.
export function requireAiStepDetails(flows: ApplicationFlow[]) {
  const issues = flows.flatMap(flow => flow.nodes.flatMap(node => {
    const missing = [!node.actor.trim() && "actor", !node.description.trim() && "description",
      node.kind !== "start" && node.kind !== "end" && !node.checks.length && "checks"].filter(Boolean);
    return missing.length ? [`${flow.name} / ${node.id}: add ${missing.join(", ")}`] : [];
  }));
  if (issues.length) throw new Error(`AI step details are incomplete in ${issues.length} steps. Every step needs an actor and description; nonterminal steps also need concrete checks. ${issues.slice(0, 12).join("; ")}`);
}
export function requireAiPresentationNotes(flows: ApplicationFlow[]) {
  const missing = flows.filter(flow => !flow.presentationNotes?.trim());
  if (missing.length) throw new Error(`AI presenter write-ups are incomplete. Add nonblank presentationNotes to these flows: ${missing.map(flow => flow.name).join(", ")}. Write a speaker script explaining the purpose, actual steps, decisions and outcomes. Preserve existing scripts when present.`);
}
export function normalizeAiProposal(input: unknown, context: AiContext): AiProposal {
  const parsed = aiProposalSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 12).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
  const proposal = parsed.data;
  assertAiDiagramScope(proposal.flows, context);
  if (new TextEncoder().encode(JSON.stringify(proposal)).length > AI_MAX_PROPOSAL_BYTES) throw new Error("Propose fewer flows at a time (350 KB limit).");
  if (proposal.flows.reduce((n, flow) => n + flow.nodes.length, 0) > 200) throw new Error("Propose at most 200 steps in one change.");
  const existing = new Map(context.flows.map(item => [item.flow.id, item.flow]));
  const proposedIds = new Set(proposal.flows.map(flow => flow.id));
  if (proposedIds.size !== proposal.flows.length) throw new Error("Each proposed flow needs a unique ID.");
  const allIds = new Set([...existing.keys(), ...proposedIds]);
  if (allIds.size > 100 || proposal.flowOrder.length !== allIds.size || new Set(proposal.flowOrder).size !== allIds.size || proposal.flowOrder.some(id => !allIds.has(id))) throw new Error("flowOrder must contain every existing and proposed flow exactly once. Flows cannot be deleted.");
  assertAiDiagramOrder(proposal.flowOrder, context);
  const mapping = new Map([...allIds].map(id => [id, existing.has(id) ? id : crypto.randomUUID()]));
  const warnings: string[] = [];
  const flows = proposal.flows.map(original => {
    const flow: ApplicationFlow = { ...original, version: 1, projectId: context.projectId, id: mapping.get(original.id)!, nodes: original.nodes.map(node => {
      if (!node.subflowId) return node;
      const target = mapping.get(node.subflowId);
      // Retain an existing external link, but never let AI invent or discover one.
      const prior = existing.get(original.id)?.nodes.find(item => item.id === node.id);
      if (!target && prior?.subflowId !== node.subflowId) throw new Error(`Unknown detail-flow link in ${original.name}: ${node.subflowId}`);
      return { ...node, subflowId: target ?? node.subflowId };
    }) };
    // Diagram edits must not erase a presenter's separately authored write-up.
    if (flow.presentationNotes === undefined && existing.get(original.id)?.presentationNotes !== undefined) flow.presentationNotes = existing.get(original.id)!.presentationNotes;
    const prior = existing.get(original.id);
    if (prior?.presentationNotes?.trim() && flow.presentationNotes === prior.presentationNotes &&
        (flow.name !== prior.name || flow.description !== prior.description || flow.diagramType !== prior.diagramType || JSON.stringify(flow.groups) !== JSON.stringify(prior.groups) || JSON.stringify(flow.nodes) !== JSON.stringify(prior.nodes) || JSON.stringify(flow.edges) !== JSON.stringify(prior.edges))) {
      warnings.push(`${flow.name}: Existing presenter write-up preserved. Review it against the changed flow, or ask AI to update the write-up.`);
    }
    const report = inspectFlow(flow);
    if (!report.valid) throw new Error(`${flow.name}: ${report.issues.slice(0, 12).map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
    warnings.push(...report.warnings.map(warning => `${flow.name}: ${warning}`));
    return report.flow!;
  });
  // Preserved scripts also count toward the draft budget.
  if (new TextEncoder().encode(JSON.stringify({ ...proposal, flows })).length > AI_MAX_PROPOSAL_BYTES) throw new Error("Propose fewer flows at a time (350 KB limit, including preserved presenter write-ups).");
  return { id: crypto.randomUUID(), summary: proposal.summary, assumptions: proposal.assumptions, warnings, flows, flowOrder: proposal.flowOrder.map(id => mapping.get(id)!),
    changes: flows.map(flow => {
      const before = existing.get(flow.id), nodes = new Map(before?.nodes.map(node => [node.id, node]) ?? []), ids = new Set(flow.nodes.map(node => node.id));
      return { id: flow.id, name: flow.name, kind: before ? "update" : "create", addedSteps: flow.nodes.filter(node => !nodes.has(node.id)).map(node => node.title), removedSteps: (before?.nodes ?? []).filter(node => !ids.has(node.id)).map(node => node.title), changedSteps: flow.nodes.filter(node => nodes.has(node.id) && JSON.stringify(nodes.get(node.id)) !== JSON.stringify(node)).map(node => node.title), connectionsBefore: before?.edges.length ?? 0, connectionsAfter: flow.edges.length };
    }) };
}
