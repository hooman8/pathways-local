import { authoringInstructions, authoringTools, type ToolSchema } from "@/lib/authoring-runner";
import { checkLocalApi, localApiError, localJson } from "@/lib/local-api";

export const runtime = "nodejs";
function jsonSchema(schema: ToolSchema): Record<string, unknown> {
  return { type: schema.type.toLowerCase(), ...(schema.description ? { description: schema.description } : {}), ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.items ? { items: jsonSchema(schema.items) } : {}), ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, jsonSchema(value)])), required: schema.required ?? [], additionalProperties: false } : {}) };
}
export async function GET(request: Request) {
  try {
    checkLocalApi(request);
    return localJson({ version: 1, edition: "local", apiKeyRequired: false, projectBundle: { format: "pathways-project-bundle", version: 1 },
      diagramTypes: ["workflow", "architecture"], instructions: authoringInstructions,
      proposalSchema: jsonSchema(authoringTools.find(tool => tool.name === "propose_changes")!.parameters),
      endpoints: { projects: "/api/projects", project: "/api/agent/project?projectId=<id>", propose: "/api/agent/proposals", readDraft: "/api/ai/sessions/<sessionId>", apply: "/api/ai/sessions/<sessionId>/apply", validateDiagram: "/api/flows/validate", projectBundles: "/api/project-bundles" },
      writeHeaders: { "Content-Type": "application/json", "X-Pathways-Client": "1", Origin: new URL(request.url).origin },
      proposalRequest: { requestId: "UUID (retain for retries)", projectId: "selected project ID", diagramType: "workflow or architecture", base: "complete saved-order [{id,revision}] from GET project", proposal: "object conforming to proposalSchema" },
      applyRequest: { revision: "reviewed session revision", proposalId: "reviewed session.proposal.id" },
      review: "Propose saves a local draft only. Open its returned reviewUrl, inspect definitions and assumptions, and Apply after review. API keys and conversations are excluded from project transfers." });
  } catch (error) { return localApiError(error); }
}
