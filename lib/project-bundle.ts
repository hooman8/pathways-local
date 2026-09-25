import { z } from "zod";
import { applicationFlowSchema, validateFlow, type ApplicationFlow } from "./application-flow";
import { projectSchema, engineerSchema, teamSchema, validateWorkspace, exportProject, mergeProjectImport, type Workspace } from "./projects";

export const MAX_BUNDLE_BYTES = 5_000_000;
const bundleSchema = z.object({
  format: z.literal("pathways-project-bundle"), version: z.literal(1),
  project: projectSchema, engineers: z.array(engineerSchema).max(50), teams: z.array(teamSchema).max(500),
  flows: z.array(applicationFlowSchema).max(200), flowOrder: z.array(z.string().min(1).max(100)).max(200),
}).strict();
export type ProjectBundle = z.infer<typeof bundleSchema>;
export type BundleImportResult = { project: { id: string; name: string; flowCount: number }; flowIds: string[]; warnings: string[] };
export function validateBundle(input: unknown): ProjectBundle {
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_BUNDLE_BYTES) throw new Error("A complete project file must be smaller than 5 MB.");
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) throw new Error("Choose a version-1 Pathways complete project file with a project, engineers, teams, flows, and flowOrder.");
  const data = parsed.data;
  const workspace = validateWorkspace({ version: 2, activeProjectId: data.project.id, projects: [data.project], engineers: data.engineers, teams: data.teams, templates: [] });
  const ids = new Set(data.flows.map(flow => flow.id));
  if (ids.size !== data.flows.length || new Set(data.flowOrder).size !== ids.size || data.flowOrder.length !== ids.size || data.flowOrder.some(id => !ids.has(id))) throw new Error("Flow order must include every flow exactly once.");
  for (const flow of data.flows) {
    validateFlow(flow);
    if (flow.projectId !== data.project.id) throw new Error("Every included flow must belong to the exported project.");
    if (new TextEncoder().encode(JSON.stringify(flow)).length > 750_000) throw new Error(`Split “${flow.name}” into smaller flows before transferring it (750 KB per flow).`);
  }
  return { ...data, project: workspace.projects[0], engineers: workspace.engineers, teams: workspace.teams };
}
export function bundleWarnings(bundle: ProjectBundle): string[] {
  const ids = new Set(bundle.flowOrder);
  const external = bundle.flows.flatMap(flow => flow.nodes.filter(node => node.subflowId && !ids.has(node.subflowId)));
  return external.length ? [`${external.length} detail-flow link(s) point outside this project. Those links will be disconnected on import; the steps and their descriptions will remain.`] : [];
}
export function exportBundle(workspace: Workspace, projectId: string, flows: ApplicationFlow[]): ProjectBundle {
  const project = workspace.projects.find(project => project.id === projectId);
  if (!project) throw new Error("This project does not exist.");
  const exported = exportProject(project, workspace.engineers, workspace.teams);
  return validateBundle({ format: "pathways-project-bundle", version: 1, project: exported.project, engineers: exported.engineers, teams: exported.teams, flows, flowOrder: flows.map(flow => flow.id) });
}
export function prepareBundleImport(workspace: Workspace, input: unknown, requestedName?: string) {
  const bundle = validateBundle(input), baseName = (requestedName ?? bundle.project.roadmap.application).trim();
  if (!baseName || baseName.length > 100) throw new Error("Choose a project name between 1 and 100 characters.");
  let name = baseName, suffix = 2;
  while (workspace.projects.some(project => project.roadmap.application.toLowerCase() === name.toLowerCase())) name = `${baseName.slice(0, 80)} (imported ${suffix++})`;
  const next = mergeProjectImport(workspace, { projects: [{ ...bundle.project, roadmap: { ...bundle.project.roadmap, application: name } }], engineers: bundle.engineers, teams: bundle.teams });
  const projectId = next.activeProjectId;
  const ids = new Map(bundle.flowOrder.map(id => [id, crypto.randomUUID()]));
  const byId = new Map(bundle.flows.map(flow => [flow.id, flow]));
  const flows = bundle.flowOrder.map(id => {
    const original = byId.get(id)!;
    return validateFlow({ ...original, id: ids.get(id), projectId, nodes: original.nodes.map(node => {
      if (!node.subflowId) return node;
      const { subflowId, ...rest } = node;
      const mapped = ids.get(subflowId);
      return mapped ? { ...rest, subflowId: mapped } : rest;
    }) });
  });
  const result: BundleImportResult = { project: { id: projectId, name, flowCount: flows.length }, flowIds: flows.map(flow => flow.id), warnings: bundleWarnings(bundle) };
  return { workspace: next, flows, result };
}
