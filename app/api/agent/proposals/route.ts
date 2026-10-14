import { z } from "zod";
import { checkLocalApi, localApiError, localJson, readLocalJson } from "@/lib/local-api";
import { localRepository } from "@/lib/sqlite-repository";
import { localOwner } from "@/lib/local-access";
import { diagramUrl } from "@/lib/diagram-view";
import { WorkspaceStore } from "@/lib/workspace-store";
export const runtime = "nodejs";
const inputSchema = z.object({ requestId: z.string().uuid(), projectId: z.string().min(1).max(100), diagramType: z.enum(["workflow", "architecture"]).default("workflow"),
  base: z.array(z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() }).strict()).max(40), proposal: z.unknown() }).strict();
export async function POST(request: Request) {
  try {
    checkLocalApi(request, true);
    const input = inputSchema.parse(await readLocalJson(request, 400_000)), repository = localRepository();
    await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    const session = repository.createAgentProposal({ ...input, proposal: input.proposal });
    return localJson({ session, reviewUrl: `${diagramUrl(session.projectId, input.diagramType)}&draft=${session.id}`, applyUrl: `/api/ai/sessions/${session.id}/apply` }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return localJson({ error: "Send requestId, projectId, diagramType, the full saved base, and proposal. Read /api/agent for the schema." }, 400);
    return localApiError(error);
  }
}
