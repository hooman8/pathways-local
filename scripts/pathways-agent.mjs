#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";

const help = `Pathways Local agent CLI (run from your checkout)
  npm run agent -- capabilities [--url http://localhost:8080]
  npm run agent -- projects
  npm run agent -- project --project PROJECT_ID
  npm run agent -- read --flow DIAGRAM_ID
  npm run agent -- validate --file diagram.json
  npm run agent -- propose --file proposal-request.json
  npm run agent -- draft --session SESSION_ID
  npm run agent -- apply --session SESSION_ID --revision NUMBER --proposal PROPOSAL_ID
  npm run agent -- export --project PROJECT_ID > project.json

propose creates a reviewable draft; apply is an explicit, atomic save.
No Pathways AI subscription or API key is needed by this CLI.
Every command supports --url. Keep exported project data outside source control.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(["url", "project", "flow", "file", "session", "revision", "proposal"].map(name => [name, { type: "string" }])) });
  const command = positionals[0];
  if (!command || command === "help") { process.stdout.write(help + "\n"); process.exit(0); }
  const root = new URL(values.url ?? process.env.PATHWAYS_URL ?? "http://localhost:8080");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(root.hostname) || !["http:", "https:"].includes(root.protocol) || root.username || root.password || root.pathname !== "/" || root.search || root.hash) throw new Error("--url must be the configured localhost origin.");
  const required = name => { if (!values[name]) throw new Error(`Provide --${name}.`); return values[name]; };
  let path, method = "GET", body;
  if (command === "capabilities") path = "/api/agent";
  else if (command === "projects") path = "/api/projects";
  else if (command === "project") path = `/api/agent/project?projectId=${encodeURIComponent(required("project"))}`;
  else if (command === "read") path = `/api/flows/${encodeURIComponent(required("flow"))}`;
  else if (command === "draft") path = `/api/ai/sessions/${encodeURIComponent(required("session"))}`;
  else if (command === "export") path = `/api/project-bundles?projectId=${encodeURIComponent(required("project"))}`;
  else if (["validate", "propose"].includes(command)) {
    const input = JSON.parse(await readFile(required("file"), "utf8"));
    path = command === "validate" ? "/api/flows/validate" : "/api/agent/proposals";
    body = command === "validate" ? { flow: input } : input; method = "POST";
  } else if (command === "apply") {
    const revision = Number(required("revision"));
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Provide a positive --revision from the reviewed draft.");
    path = `/api/ai/sessions/${encodeURIComponent(required("session"))}/apply`;
    body = { revision, proposalId: required("proposal") }; method = "POST";
  } else throw new Error(`Unknown command.\n${help}`);
  const response = await fetch(new URL(path, root), { method, headers: { "Content-Type": "application/json", "X-Pathways-Client": "1", Origin: root.origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000), redirect: "error" });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error ?? "Check the request."}${data.issues ? "\n" + JSON.stringify(data.issues) : ""}`);
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
} catch (error) { process.stderr.write((error instanceof Error ? error.message : "Agent command failed.") + "\n"); process.exitCode = 1; }
