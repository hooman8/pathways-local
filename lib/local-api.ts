import { assertLocalRequest, assertSameOrigin } from "./local-access";
import { WorkspaceError } from "./workspace-store";

export const localJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
export function checkLocalApi(request: Request, write = false) {
  try { assertLocalRequest(request); if (write) assertSameOrigin(request); }
  catch { throw new WorkspaceError(403, "Open the workspace at its configured localhost address. Local writes require Origin and X-Pathways-Client headers."); }
}
export async function readLocalJson(request: Request, maximum: number) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkspaceError(415, "Send JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError(400, "Send a JSON request.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new WorkspaceError(413, "This request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new WorkspaceError(400, "Invalid JSON."); }
}
export function localApiError(error: unknown) {
  if (error instanceof WorkspaceError) return localJson({ error: error.message }, error.status);
  return localJson({ error: "Could not complete this local request. Your saved projects are intact." }, 503);
}
