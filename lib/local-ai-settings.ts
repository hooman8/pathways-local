import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

type Environment = Record<string, string | undefined>;
const keySchema = z.string().trim().min(20).max(4096).regex(/^\S+$/, "Enter the API key without spaces.");
const fileSchema = z.object({ version: z.literal(1), apiKey: keySchema }).strict();
export const aiKeyInput = z.object({ apiKey: keySchema }).strict();
export function aiSettingsPath(env: Environment = process.env) {
  return resolve(env.PATHWAYS_AI_SETTINGS_PATH ?? `${dirname(resolve(env.PATHWAYS_DB_PATH ?? "data/pathways.sqlite"))}/ai-credentials.json`);
}
export function readAstraKey(env: Environment = process.env): { apiKey: string; source: "environment" | "local" | "none" } {
  const environmentKey = env.OPENAI_API_KEY?.trim();
  if (environmentKey) return { apiKey: keySchema.parse(environmentKey), source: "environment" };
  const filename = aiSettingsPath(env);
  if (!existsSync(filename)) return { apiKey: "", source: "none" };
  if (statSync(filename).size > 8192) throw new Error("Invalid local AI settings file.");
  const stored = fileSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
  // Tighten permissions for existing settings files as well as new ones.
  chmodSync(filename, 0o600);
  return { apiKey: stored.apiKey, source: "local" };
}
export function saveAstraKey(input: unknown, env: Environment = process.env) {
  const { apiKey } = aiKeyInput.parse(input), filename = aiSettingsPath(env), temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  mkdirSync(dirname(filename), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, apiKey }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, filename);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export function removeAstraKey(env: Environment = process.env) {
  const filename = aiSettingsPath(env);
  try { unlinkSync(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export function publicAiSettings(env: Environment = process.env) {
  const { apiKey, source } = readAstraKey(env);
  return { configured: !!apiKey, enabled: !!apiKey && env.PATHWAYS_OPENAI_ENABLED !== "false", source, model: env.OPENAI_MODEL ?? "gpt-6-astra", canRemove: existsSync(aiSettingsPath(env)) };
}
