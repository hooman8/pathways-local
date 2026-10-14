# AI and local agent authoring

[Documentation home](../README.md)

Pathways Local offers the same workflow/architecture preview and Apply experience
as the private edition. It does not include a managed AI subscription. Core editing,
imports, exports, and local agent access work without a Pathways provider key.

## Astra with your own key

In Application flows or Architecture, choose **AI settings**, paste your OpenAI API
key, and **Save key**. Then choose a project and **Build with AI**. Describe actors,
requirements, timing, decisions, failure/recovery behavior, or system components,
boundaries, technologies, and connections. Astra can ask clarifying questions,
generate an overview plus linked detail diagrams, and refine a pending draft.

Review Diagram preview, Component/Step details, Presenter notes, assumptions, and
Changes and saved order. **Apply to project** saves the reviewed set and order in
one SQLite transaction. Generating or refining a draft does not alter saved diagrams.
A stale draft is rejected; ask Astra to refresh against the current project.

Astra uses `gpt-6-astra` through the OpenAI Responses API with strict authoring
tools, streaming, and `store:false`. The app sends only this conversation and the
selected project's diagram definitions, not the entire workspace or directory.
Provider calls stay on the server. OpenAI usage is billed to your key's account;
ChatGPT/Codex subscriptions do not supply this app's API billing. The integration
follows [OpenAI's function-calling guide](https://developers.openai.com/api/docs/guides/function-calling)
and [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

The saved key is an unencrypted, mode-0600 server file next to the database, not a
browser/localStorage value. The app never returns the key through settings reads
and never includes it in project exports. You can replace or remove it in settings.
An optional server `OPENAI_API_KEY` overrides the saved file. Full data-directory
backups contain credentials and conversations, so keep them private.

Conversations and jobs persist locally. Closing the dialog does not cancel work.
Reload restores the conversation. One Astra generation runs at a time, with a
15-minute deadline and at most 20 user messages per conversation. Proposals support
up to 12 diagrams, 200 total nodes, and 350 KB; the selected project context supports
40 saved diagrams and 250 KB. Use linked detail diagrams and smaller changes for
larger designs. A model's structurally valid diagram still needs a human review of
business rules and assumptions. Diagrams do not execute code or integrations.

## Use an agent on your computer

Choose **Use a local agent** in either view. Copy the instructions into your agent
and add your requirements. The instructions include the selected project and
local origin, so an agent can read current definitions, create a validated proposal,
and return a review link. Your agent uses its own model connection, subscription,
or local model; Pathways does not need an API key for this route.

The API and CLI support both workflows and architecture, including multiple linked
diagrams and presenter notes. Proposals preserve unrelated diagrams and complete
project order. They create a draft only. Apply rechecks the exact saved revisions
and order, then commits all updates, new diagrams, order, and its receipt together.
No partial project save is accepted if any diagram is invalid or stale.

From the Pathways Local checkout:

```sh
npm run agent -- capabilities
npm run agent -- projects
npm run agent -- project --project PROJECT_ID
npm run agent -- validate --file diagram.json
npm run agent -- propose --file proposal-request.json
npm run agent -- draft --session SESSION_ID
npm run agent -- apply --session SESSION_ID --revision 1 --proposal PROPOSAL_ID
npm run agent -- export --project PROJECT_ID > /path/outside/repository/project.json
```

Each command accepts `--url http://localhost:PORT`; the default is
`http://localhost:8080`. `npm run agent -- help` lists all commands. The app must be
running. Docker users run the CLI on the host from their source checkout.

### HTTP contract

| Endpoint | Purpose |
| --- | --- |
| `GET /api/agent` | Instructions, machine-readable proposal schema, routes and capabilities |
| `GET /api/agent/project?projectId=<id>` | Project name, all ordered snapshots and `base` revisions |
| `POST /api/agent/proposals` | Validate and store a local agent draft; returns `reviewUrl` |
| `GET /api/ai/sessions/<id>` | Read the draft, changes, assumptions and status |
| `POST /api/ai/sessions/<id>/apply` | Atomically apply the reviewed draft |
| `POST /api/flows/validate` | Validate a portable single-diagram definition without saving |

Writes require `Content-Type: application/json`, `X-Pathways-Client: 1`, and
`Origin` equal to the configured localhost origin. Host/origin checks also protect
reads. The service remains for one local owner and is not exposed on the network.

A proposal request contains:

```json
{
  "requestId": "a-fresh-UUID-retained-for-retries",
  "projectId": "selected-project-id",
  "diagramType": "architecture",
  "base": [{"id": "saved-diagram-id", "revision": 1}],
  "proposal": {
    "summary": "Describe the proposed change.",
    "assumptions": [],
    "flows": ["new-or-changed-definitions-conforming-to-proposalSchema"],
    "flowOrder": ["every-existing-and-proposed-diagram-id-in-order"]
  }
}
```

The example illustrates fields, not a submit-ready graph. Use the actual schema
from `/api/agent` and exact `base` from the project read. New definitions use unique
symbolic IDs; the server replaces them with UUIDs and repairs internal detail links.
Keep existing IDs for edits. Do not put `version` or `projectId` inside proposed
definitions: the server assigns them. Preserve other-view diagram positions and
append new diagrams. Use separate workflow and architecture proposals when creating
both types. Optional presenter notes are ordinary portable content; provide a
useful script when creating a diagram and omit the field to preserve an existing one.

Retain `requestId` and exact content for retries. Repeating the same request returns
the original draft; reusing it for different content returns 409. Apply takes
`{"revision":1,"proposalId":"the-reviewed-proposal-UUID"}` and is idempotent for
the same applied proposal. A 409 means read the latest project/draft and review
again. Raw single-flow create/update APIs remain available for existing agents,
but use the proposal API for a set that needs to commit together.

## Transfer between editions

Applied definitions are ordinary version-1 workflows or architecture diagrams.
**Export complete project** includes the roadmap, all diagrams, order, internal
links, architecture metadata, and presenter notes. Both compatible editions can
read/edit them without any AI connection. Keys, conversations, pending drafts,
generation jobs, sign-in accounts, and Apply receipts stay in their installation.
See [project transfers](project-transfers.md).
