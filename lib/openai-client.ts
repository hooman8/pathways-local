import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceError } from "./workspace-store";
import { authoringInstructions, authoringTools, type AuthoringGenerate, type ToolSchema } from "./authoring-runner";
import { readAstraKey } from "./local-ai-settings";

export function openaiSettings(env: Record<string, string | undefined> = process.env) {
  const model = env.OPENAI_MODEL ?? "gpt-6-astra";
  const effort = env.OPENAI_REASONING_EFFORT ?? "high";
  const output = env.OPENAI_MAX_OUTPUT_TOKENS ?? "128000";
  if (model !== "gpt-6-astra" || !["low", "medium", "high", "xhigh", "max"].includes(effort) || !/^\d+$/.test(output) || Number(output) < 1024 || Number(output) > 128000) throw new WorkspaceError(503, "Check the Astra model, reasoning effort, and output token configuration.");
  return { enabled: env.PATHWAYS_OPENAI_ENABLED !== "false" && !!env.OPENAI_API_KEY?.trim(), model, effort, maxOutputTokens: Number(output) };
}

// Strict Responses schemas express optional properties as required nullable values.
// The portable diagram schema still uses omission, so normalize only those fields.
function strictSchema(schema: ToolSchema, optional = false): Record<string, unknown> {
  const type = schema.type.toLowerCase();
  return { type: optional ? [type, "null"] : type,
    ...(schema.enum ? { enum: optional ? [...schema.enum, null] : schema.enum } : {}),
    ...(schema.description ? { description: schema.description } : {}),
    ...(schema.items ? { items: strictSchema(schema.items) } : {}),
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, strictSchema(child, !schema.required?.includes(key))])), required: Object.keys(schema.properties), additionalProperties: false } : {}),
  };
}
function omitOptionalNulls(value: unknown, schema: ToolSchema): unknown {
  if (Array.isArray(value) && schema.items) return value.map(item => omitOptionalNulls(item, schema.items!));
  if (value && typeof value === "object" && schema.properties) return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(item === null && schema.properties![key] && !schema.required?.includes(key))).map(([key, item]) => [key, schema.properties![key] ? omitOptionalNulls(item, schema.properties![key]) : item]));
  return value;
}
export const openaiTools = authoringTools.map(tool => ({ ...tool, type: "function", strict: true, parameters: strictSchema(tool.parameters) }));

// Long drafts can exceed an HTTP client's response-header timeout. Receive SSE
// immediately, but expose no partial arguments: only a completed response is usable.
export async function readOpenaiStream(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new WorkspaceError(502, "Astra did not return a generation stream. Retry the request.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8_000_000) throw new WorkspaceError(502, "Astra's response exceeded the supported event size.");
      // An SSE event may span UTF-8 bytes, network chunks, and multiple data lines.
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        let item;
        try { item = JSON.parse(data); } catch { throw new WorkspaceError(502, "Astra's generation stream was interrupted. Retry the request."); }
        if (item.type === "response.completed") return item.response;
        if (["error", "response.failed", "response.incomplete"].includes(item.type)) throw new WorkspaceError(502, "Astra could not finish a complete draft. Your saved flows are intact; retry or use a smaller request.");
      }
    }
    throw new WorkspaceError(502, "Astra's connection ended before the draft completed. Your conversation is kept; retry the request.");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function openaiGenerator(model?: string): AuthoringGenerate {
  const { apiKey } = readAstraKey();
  const settings = openaiSettings({ ...process.env, OPENAI_API_KEY: apiKey });
  if (!settings.enabled) throw new WorkspaceError(503, "Connect your OpenAI API key in AI settings to use Astra. Local agents do not need a key.");
  if (model && model !== settings.model) throw new WorkspaceError(503, "This conversation's Astra model is unavailable. Start a new conversation.");
  return createOpenaiGenerator(settings, apiKey);
}

export function createOpenaiGenerator(settings: ReturnType<typeof openaiSettings>, apiKey: string, http: typeof fetch = fetch, pause: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal })): AuthoringGenerate {
  let requests = 0;
  return async (contents, signal) => {
    const input = contents.flatMap<Record<string, unknown>>(content => {
      if (content.role === "model") {
        if (!content.providerOutput) throw new WorkspaceError(502, "Astra conversation state is incomplete. Retry the request.");
        // Preserve the complete wire output, including encrypted reasoning and call IDs.
        return content.providerOutput;
      }
      return content.parts.map(part => part.functionResponse ? { type: "function_call_output", call_id: part.functionResponse.id, output: JSON.stringify(part.functionResponse.response) } : { role: "user", content: part.text ?? "" });
    });
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      if (++requests > 12) throw new WorkspaceError(502, "Astra's retry limit was reached. Try a smaller request shortly.");
      response = await http("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ model: settings.model, instructions: authoringInstructions, input, tools: openaiTools, tool_choice: "required", parallel_tool_calls: true, store: false, stream: true, reasoning: { effort: settings.effort }, max_output_tokens: settings.maxOutputTokens }) });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      const retryAfter = response.headers.get("retry-after");
      const providerDelay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 0;
      await pause(Math.min(120_000, Math.max(15_000 * 2 ** attempt, Number.isFinite(providerDelay) ? providerDelay : 0)), signal);
    }
    if (!response.ok) {
      // Provider error bodies may echo credentials or project content. Never surface them.
      if (response.status === 429) throw new WorkspaceError(429, "Astra is busy or the OpenAI API quota is exhausted. Check API billing and limits, then retry.");
      if ([401, 403].includes(response.status)) throw new WorkspaceError(503, "Check your OpenAI API key and Astra model permissions in AI settings.");
      throw new WorkspaceError(502, `Astra could not complete this request (HTTP ${response.status}). Check your OpenAI model access.`);
    }
    const body = await readOpenaiStream(response, signal);
    if (body.status !== "completed" || !Array.isArray(body.output) || !body.output.length) throw new WorkspaceError(502, "Astra could not finish a complete draft. Try a smaller request or rephrase the description.");
    const output = body.output as Record<string, unknown>[];
    const calls = output.filter(item => item.type === "function_call");
    const ids = new Set<unknown>();
    const parts = calls.map(call => {
      if (typeof call.call_id !== "string" || !call.call_id || ids.has(call.call_id) || typeof call.name !== "string" || typeof call.arguments !== "string") throw new WorkspaceError(502, "Astra returned an incomplete authoring action. Retry the request.");
      ids.add(call.call_id);
      let args: unknown;
      try { args = JSON.parse(call.arguments); } catch { throw new WorkspaceError(502, "Astra returned incomplete action arguments. Retry with a smaller request."); }
      const schema = authoringTools.find(tool => tool.name === call.name)?.parameters;
      return { functionCall: { name: call.name, id: call.call_id, args: schema ? omitOptionalNulls(args, schema) : args } };
    });
    return { role: "model", parts, providerOutput: output };
  };
}
