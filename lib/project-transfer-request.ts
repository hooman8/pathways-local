import { createHash } from "node:crypto";
import { z } from "zod";
import { validateBundle, MAX_BUNDLE_BYTES } from "./project-bundle";
export const transferRequestSchema = z.object({ bundle: z.unknown(), name: z.string().trim().min(1).max(100).optional(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), importId: z.string().uuid() }).strict();
export function parseTransfer(input: unknown) {
  const parsed = transferRequestSchema.parse(input), bundle = validateBundle(parsed.bundle);
  const digest = createHash("sha256").update(JSON.stringify({ bundle, name: parsed.name ?? null })).digest("hex");
  return { ...parsed, bundle, digest };
}
export async function readTransfer(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Send a JSON project file.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Choose a complete project file.");
  let size = 0, text = ""; const decoder = new TextDecoder();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_BUNDLE_BYTES + 2048) { await reader.cancel(); throw new Error("A complete project file must be smaller than 5 MB."); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(text + decoder.decode());
}
