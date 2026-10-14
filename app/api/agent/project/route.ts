import { checkLocalApi, localApiError, localJson } from "@/lib/local-api";
import { localRepository } from "@/lib/sqlite-repository";
import { localOwner } from "@/lib/local-access";
import { WorkspaceError, WorkspaceStore } from "@/lib/workspace-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    checkLocalApi(request);
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId || projectId.length > 100) throw new WorkspaceError(400, "Choose a project ID.");
    const repository = localRepository();
    await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    return localJson(repository.readAuthoringProject(projectId));
  } catch (error) { return localApiError(error); }
}
