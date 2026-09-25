import { assertLocalRequest, assertSameOrigin, localOwner } from "@/lib/local-access";
import { localRepository } from "@/lib/sqlite-repository";
import { WorkspaceStore, WorkspaceError } from "@/lib/workspace-store";
import { readTransfer } from "@/lib/project-transfer-request";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function handle(request: Request, importing: boolean) {
  try {
    try { assertLocalRequest(request); if (importing) assertSameOrigin(request); }
    catch { return Response.json({ error: "This request must come from the local workspace." }, { status: 403, headers }); }
    const repository = localRepository();
    await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    if (!importing) {
      const id = new URL(request.url).searchParams.get("projectId");
      if (!id) throw new WorkspaceError(400, "Select a project to export.");
      return Response.json(repository.exportProjectBundle(id), { headers });
    }
    const result = repository.importProjectBundle(await readTransfer(request));
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not transfer this project." }, { status: error instanceof WorkspaceError ? error.status : 400, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
