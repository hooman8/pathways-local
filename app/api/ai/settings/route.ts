import { aiKeyInput, publicAiSettings, removeAstraKey, saveAstraKey } from "@/lib/local-ai-settings";
import { checkLocalApi, localApiError, localJson, readLocalJson } from "@/lib/local-api";
import { WorkspaceError } from "@/lib/workspace-store";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { checkLocalApi(request); return localJson(publicAiSettings()); }
  catch (error) { return localApiError(error); }
}
export async function PUT(request: Request) {
  try {
    checkLocalApi(request, true);
    const input = aiKeyInput.safeParse(await readLocalJson(request, 8192));
    if (!input.success) throw new WorkspaceError(400, "Enter a valid API key (20–4,096 characters, without spaces).");
    saveAstraKey(input.data);
    return localJson(publicAiSettings());
  } catch (error) { return localApiError(error); }
}
export async function DELETE(request: Request) {
  try { checkLocalApi(request, true); removeAstraKey(); return localJson(publicAiSettings()); }
  catch (error) { return localApiError(error); }
}
