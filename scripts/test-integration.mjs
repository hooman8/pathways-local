import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

await access(".next/BUILD_ID").catch(() => { throw new Error("Run npm run build before npm run test:integration."); });
const directory = await mkdtemp(join(tmpdir(), "pathways-integration-build-"));
try {
  const outfile = join(directory, "integration.mjs");
  await build({ entryPoints: ["tests/integration.test.ts"], bundle: true, platform: "node", format: "esm", outfile });
  const result = spawnSync(process.execPath, ["--test", outfile], {
    env: { ...process.env, PATHWAYS_TEST_ROOT: resolve(".") }, stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
