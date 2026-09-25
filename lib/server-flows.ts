import { assertLocalRequest, assertSameOrigin } from "./local-access";
import { inspectFlow, type ApplicationFlow } from "./application-flow";
import { localRepository } from "./sqlite-repository";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
async function bodyJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "Send JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Send a flow definition.");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new RequestError(413, "A flow request must be smaller than 2 MB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RequestError(400, "Invalid JSON."); }
}

export async function flowsApi(request: Request, action: "list" | "get" | "create" | "update" | "validate", id?: string) {
  try {
    try { assertLocalRequest(request); if (!["list", "get"].includes(action)) assertSameOrigin(request); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Open the local workspace." }, 403); }
    if (action === "list") return json({ flows: localRepository().listFlows() });
    if (action === "get") {
      const snapshot = localRepository().readFlow(id!);
      return snapshot ? json(snapshot) : json({ error: "This flow does not exist." }, 404);
    }
    const body = await bodyJson(request);
    const report = inspectFlow(body?.flow);
    if (!report.valid || !report.flow) return json({ valid: false, error: "Check the flow definition.", issues: report.issues, warnings: report.warnings }, 400);
    const flow: ApplicationFlow = report.flow;
    if (action === "validate") return json({ valid: true, issues: [], warnings: report.warnings, flow });
    if (action === "create") {
      const snapshot = localRepository().createFlow(flow);
      return snapshot ? json(snapshot, 201) : json({ error: "A flow with this ID already exists. Read it before editing, or choose a new ID." }, 409);
    }
    if (id !== flow.id) return json({ error: "The flow ID must match the URL." }, 400);
    if (!Number.isSafeInteger(body?.revision) || body.revision < 1) return json({ error: "A valid revision is required." }, 400);
    const snapshot = localRepository().updateFlow(flow, body.revision);
    if (snapshot) return json(snapshot);
    const current = localRepository().readFlow(id!);
    return current ? json({ error: "This flow changed since you opened it. Your draft has been kept.", snapshot: current }, 409) : json({ error: "This flow does not exist." }, 404);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("Application flow unavailable", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "The flow database is unavailable. Your draft has been kept." }, 503);
  }
}
