import { after } from "next/server";
import { z } from "zod";
import { localRepository } from "./sqlite-repository";
import { localOwner } from "./local-access";
import { WorkspaceError, WorkspaceStore } from "./workspace-store";
import { checkLocalApi, localApiError, localJson, readLocalJson } from "./local-api";
import { publicAiSettings } from "./local-ai-settings";
import { openaiGenerator, openaiSettings } from "./openai-client";
import { runAuthoring } from "./authoring-runner";
import { type AiSession, type AiProviderOption } from "./ai-authoring";

const uuid = z.string().uuid();
function availability(session: AiSession) {
  const settings = publicAiSettings();
  const providers: AiProviderOption[] = [{ id: "openai", label: "Astra", model: settings.model, enabled: settings.enabled }];
  return { enabled: session.provider === "openai" && settings.enabled, providers };
}
export async function runLocalAiJob(id: string, requestId: string) {
  const repository = localRepository();
  try {
    const job = repository.claimAiJob(id, requestId);
    if (!job) return;
    const result = await runAuthoring(job.context, job.session, openaiGenerator(job.session.model), AbortSignal.timeout(job.timeoutMs));
    repository.finishAiMessage(id, requestId, result);
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
      ? "Astra took too long. Your conversation is kept; try a smaller request."
      : "Astra could not complete this draft. Your conversation is kept; retry the request.";
    // Never log provider bodies, credentials, prompts, or diagram definitions.
    try { repository.finishAiMessage(id, requestId, { error: message }); } catch { /* A superseded or expired job cannot overwrite the session. */ }
  }
}
export async function aiApi(request: Request, action: "create" | "get" | "message" | "apply", id?: string) {
  try {
    checkLocalApi(request, action !== "get");
    const repository = localRepository();
    await new WorkspaceStore(repository, localOwner.email).get(localOwner);
    if (id) uuid.parse(id);
    if (action === "get") {
      const session = repository.getAiSession(id!);
      // A response interrupted before after() dispatch can leave a durable queued job.
      // Claiming is atomic: simultaneous pollers never generate twice.
      if (session.status === "generating" && session.lastRequestId) after(() => runLocalAiJob(id!, session.lastRequestId!));
      return localJson({ session, ...availability(session) });
    }
    const body = await readLocalJson(request, 40_000);
    if (action === "create") {
      const input = z.object({ projectId: z.string().min(1).max(100), sessionId: uuid, provider: z.literal("openai").optional(), diagramType: z.enum(["workflow", "architecture"]).optional() }).strict().parse(body);
      const session = repository.createAiSession(input.projectId, input.sessionId, openaiSettings().model, "openai", input.diagramType);
      return localJson({ session, ...availability(session) }, 201);
    }
    if (action === "apply") {
      const input = z.object({ revision: z.number().int().positive(), proposalId: uuid }).strict().parse(body);
      const session = repository.applyAiProposal(id!, input.revision, input.proposalId);
      return localJson({ session, ...availability(session) });
    }
    const input = z.object({ revision: z.number().int().positive(), requestId: uuid, message: z.string().trim().min(1).max(8000) }).strict().parse(body);
    const prior = repository.getAiSession(id!);
    // Completed request replays remain readable after the owner disconnects their key.
    if (prior.lastRequestId !== input.requestId) openaiGenerator(prior.model);
    const session = repository.beginAiMessage(id!, input.revision, input.requestId, input.message);
    if (session.status === "generating") after(() => runLocalAiJob(id!, input.requestId));
    return localJson({ session, ...availability(session) }, session.status === "generating" ? 202 : 200);
  } catch (error) {
    if (error instanceof z.ZodError) return localJson({ error: "Check the message, conversation, and revision." }, 400);
    return localApiError(error);
  }
}
