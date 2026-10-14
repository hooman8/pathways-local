import test from "node:test";
import assert from "node:assert/strict";
import { createOpenaiGenerator, openaiSettings, openaiTools, readOpenaiStream } from "../lib/openai-client";

const settings = openaiSettings({ OPENAI_API_KEY: "sk-fake-key-for-tests-only" });
function event(response: unknown) { return new Response(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`, { headers: { "Content-Type": "text/event-stream" } }); }
test("Astra uses strict Responses tools, user credentials, no provider storage, and complete streamed output", async () => {
  let wire: Record<string, unknown> = {};
  const generator = createOpenaiGenerator(settings, "sk-fake-key-for-tests-only", async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init!.headers).get("authorization"), "Bearer sk-fake-key-for-tests-only");
    wire = JSON.parse(String(init!.body));
    return event({ status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "ask_questions", arguments: JSON.stringify({ message: "Clarify", questions: ["Which service owns data?"] }) }] });
  });
  const result = await generator([{ role: "user", parts: [{ text: "Create an architecture" }] }], AbortSignal.timeout(1000));
  assert.equal(wire.model, "gpt-6-astra"); assert.equal(wire.store, false); assert.equal(wire.stream, true);
  assert.ok(openaiTools.every(tool => tool.strict && tool.parameters.additionalProperties === false));
  assert.equal(result.parts[0].functionCall!.name, "ask_questions");
});
test("provider errors never echo a key or diagram content, and truncated streams are unusable", async () => {
  const generator = createOpenaiGenerator(settings, "sk-fake-key-for-tests-only", async () => new Response("secret key and project content", { status: 401 }));
  await assert.rejects(() => generator([], AbortSignal.timeout(1000)), (error: unknown) => error instanceof Error && !error.message.includes("secret key") && /API key/.test(error.message));
  await assert.rejects(() => readOpenaiStream(new Response('data: {"type":"response.output_item.added"}\n\n', { headers: { "Content-Type": "text/event-stream" } }), AbortSignal.timeout(1000)), /before the draft completed/);
  await assert.rejects(() => readOpenaiStream(event({ status: "incomplete", output: [] }), AbortSignal.abort()), /abort/i);
});
