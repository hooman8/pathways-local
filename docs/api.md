# Local API

[Documentation home](../README.md)

The API is served by the same Next.js process as the browser interface. It always
acts as the fixed local owner; no sign-in, tokens, cookies, or account management
are required. Local clients with access to the service can read and edit everything.

## Request checks

Workspace and application-flow requests must carry the actual Host matching `APP_BASE_URL`. Foreign
Origins and `Sec-Fetch-Site: cross-site` are rejected, including on reads. Writes
require the exact Origin, `Content-Type: application/json`, and
`X-Pathways-Client: 1`. Use `X-Pathways-Decisions: 1` when saving decision workflows.
Forwarded host headers are not trusted. No cross-origin access is enabled.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /api/health` | Process health, without opening the database |
| `GET /api/workspace` | Initialize if necessary and return the complete local snapshot |
| `GET /api/workspace?revision=N` | 304 when unchanged; otherwise the complete snapshot |
| `PUT /api/workspace` | Validate and atomically save `{ revision, workspace }` |
| `GET /api/projects` | List shared roadmap/flow projects, flow counts, and workspace revision |
| `POST /api/projects` | Create a project with an empty roadmap using `{ name, revision }` |
| `GET /api/flows` | List flow summaries; optional `?projectId=<id>` filter (empty means Unassigned) |
| `GET /api/flows/:id` | Read a flow snapshot |
| `POST /api/flows/validate` | Validate `{ flow }` without saving |
| `POST /api/flows` | Create `{ flow }`; existing ID returns 409 |
| `PUT /api/flows/:id` | Validate and atomically save `{ flow, revision }` |

See [Application flows](application-flows.md) for their schema, examples, and
revision rules. These APIs store diagram definitions; they do not execute them.

The snapshot retains `workspace`, `revision`, `updatedAt`, `updatedBy`, `user`,
`membership`, and `members` for compatibility with the inherited domain layer.
The user is always `local-owner`, with owner access. There are no `/api/session`
or `/api/members` routes. `/login` redirects to `/`.

Writes are limited to 2,000,000 request bytes, and the validated serialized
workspace to 1,500,000 bytes. Domain schemas impose additional limits.

| Status | Meaning |
| --- | --- |
| 200 | Loaded or saved successfully |
| 304 | Revision unchanged |
| 400 | Malformed JSON, bad revision, or invalid workspace |
| 403 | Host/origin check failed or a domain operation was disallowed |
| 409 | Stale revision; response includes the current snapshot for merging |
| 413 | Request/workspace too large |
| 415 | Write is not JSON |
| 503 | Storage unavailable; the browser keeps the unsaved draft |

The compare-and-swap check and SQLite update are atomic. A rejected write does
not partially persist its projects, templates, or directory changes. The client
can retry non-overlapping edits after merging, or ask the user to resolve conflicts.
