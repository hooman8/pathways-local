import { z } from "zod";
import { assertLocalRequest, assertSameOrigin, localOwner } from "@/lib/local-access";
import { localRepository } from "@/lib/sqlite-repository";
import { WorkspaceError, WorkspaceStore } from "@/lib/workspace-store";
import { createProject } from "@/lib/projects";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const inputSchema = z.object({ name: z.string().trim().min(1).max(100), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();

async function handle(request: Request, create: boolean) {
  try {
    try { assertLocalRequest(request); if (create) assertSameOrigin(request); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Open the local workspace." }, 403); }
    const repository = localRepository(), store = new WorkspaceStore(repository, localOwner.email);
    const current = await store.get(localOwner);
    if (!create) {
      const flows = repository.listFlows();
      return json({ revision: current.revision, projects: current.workspace!.projects.map(project => ({
        id: project.id, name: project.roadmap.application, flowCount: flows.filter(flow => flow.projectId === project.id).length,
      })), unassignedCount: flows.filter(flow => flow.projectId === null).length });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send JSON." }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Send a project name and workspace revision." }, 400);
    let text = "", size = 0; const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return json({ error: "A project request must be smaller than 4 KB." }, 413); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let input;
    try { input = inputSchema.parse(JSON.parse(text)); }
    catch { return json({ error: "Provide a project name (1–100 characters) and a valid workspace revision." }, 400); }
    if (input.revision !== current.revision) return json({ error: "Projects changed. Refresh the project list before creating a project." }, 409);
    if (current.workspace!.projects.some(p => p.roadmap.application.toLowerCase() === input.name.toLowerCase())) return json({ error: "A project with this name already exists. Select it or choose a different name." }, 409);
    const project = createProject({ version: 1, application: input.name, title: `${input.name} roadmap`, tasks: [] }, input.name, `${input.name} roadmap`);
    const saved = await store.save(localOwner, input.revision, { ...current.workspace!, projects: [...current.workspace!.projects, project] });
    return json({ project: { id: project.id, name: project.roadmap.application, flowCount: 0 }, revision: saved.revision }, 201);
  } catch (error) {
    if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
    console.error("Project catalog unavailable", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "The project catalog is unavailable. Retry shortly." }, 503);
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
