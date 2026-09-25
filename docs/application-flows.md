# Application flows

[Documentation home](../README.md)

Open **Application flows** from the roadmap sidebar, or visit `/flows`. This view
models how an application behaves: people, approvals, APIs, decisions, persistence,
timers, recovery, and linked detail flows. It does not execute steps, send requests
to external systems, or schedule jobs. Roadmaps continue to track project work.

Select a card to read its description, checks, timer rule, and next steps. Choose
a phase to focus on that phase and its neighboring steps. Use **Steps** for a
readable list. Subflow cards can open a saved detail flow. Scroll to zoom and drag
to pan the diagram.

**New flow**, **Import flow**, and **Edit definition** open a JSON editor.
**Validate & preview** checks the model without saving. **Save flow** persists the
preview. Drafts remain in browser memory; export them before closing the page.
On a revision conflict, export your draft, discard it, select the saved flow again,
then apply your changes to the latest definition. Flow exports contain one raw
definition; linked subflows must be exported separately. Roadmap workspace exports
do not include application flows. A full SQLite backup includes both.

## Projects

Choose a **Project** in the sidebar to see only its application flows. **New
project** creates a project with an empty roadmap; the same project also appears
in Project roadmaps. You can rename it from the roadmap's project controls.
**New flow** and **Import flow** use the selected project. **Move to project**
reassigns a saved flow without changing its ID, graph, or detail-flow links.
Project switching is disabled while a flow draft is open.

Existing definitions without a project are retained under **Unassigned**. Project
membership is stored as `projectId`, not inferred from a name prefix. Flow IDs
remain globally unique, including across projects. Cross-project detail links
remain valid and select the destination project's context when opened. Projects
organize local content; they are not an access-control boundary.

Bookmarks use `/flows?project=<id>` or `/flows?project=<id>&flow=<id>`.
Existing `/flows?flow=<id>` links still work and resolve the flow's current project.
An empty `project` selects Unassigned. Exports include `projectId`; the UI imports
into the selected project so exports from another installation remain usable.
API imports must use a project ID that exists locally or set `projectId: null`.

## Arranging flows

Choose **Arrange flows** in the library to reveal **Move to top**, **Move up**, and
**Move down** buttons. Changes save immediately for the selected project, including
Unassigned. Choose **Done arranging** to hide the controls. Reordering keeps the
currently open diagram selected and never changes its definition or revision.
Editing a flow keeps its position; creating, importing, or moving one into a
project appends it to that project's list. Existing lists retain their visible
order when upgrading. A conflicting reorder or changed project membership is
rejected and the UI refreshes the list before you try again.

## Local authoring API

An agent or script running on the Mac can use these endpoints while the app runs.
The same [localhost checks](api.md#request-checks) protect every flow route.

| Method and route | Body | Response |
| --- | --- | --- |
| `GET /api/flows` | None | `{ flows: [{ id, projectId, name, description, revision, updatedAt, nodes, edges }] }` (counts for nodes/edges) |
| `GET /api/flows?projectId=<id>` | None | Flows in that project; an empty `projectId` selects Unassigned |
| `GET /api/projects` | None | `{ projects: [{ id, name, flowCount }], revision, unassignedCount }`; revision is the workspace revision |
| `POST /api/projects` | `{ name, revision }` | 201 `{ project, revision }`; 409 on stale revision or duplicate name |
| `GET /api/flows/:id` | None | `{ flow, revision, updatedAt }`, or 404 |
| `POST /api/flows/validate` | `{ flow }` | Normalized definition, `valid`, `issues`, `warnings`; never saves |
| `POST /api/flows` | `{ flow }` | 201 with saved snapshot; 409 if ID exists |
| `PUT /api/flow-order` | `{ projectId, expectedOrder, flowIds }` | `{ flows }` in saved order; 409 if the project list changed; 400 for an invalid permutation |
| `PUT /api/flows/:id` | `{ flow, revision }` | Saved snapshot; 409 plus current `snapshot` if stale |

To reorder through the API, read `/api/flows?projectId=<id>`, keep the returned
IDs in `expectedOrder`, and put your new order in `flowIds`. Both arrays must
include every flow in that project exactly once. Use `projectId: null` for
Unassigned. The reorder is atomic and only touches display positions, allowing
concurrent definition edits without invalidating their revisions.

To group definitions through the API, read `/api/projects`, then use an existing
project ID or POST a name with that response's workspace `revision`. Set a flow's
`projectId` and PUT it with its own current flow revision. Moving flows does not
change the workspace revision. Explicit `projectId: null` moves to Unassigned;
older PUT clients that omit the field preserve the existing assignment. Unknown
project IDs return 400 on create/save. `/validate` checks definition structure
without resolving project membership or saving anything.

Example: save this synthetic definition as `flow.json` and create a local flow:

```json
{
  "version": 1,
  "id": "review-example",
  "name": "Review a request",
  "nodes": [
    { "id": "start", "kind": "start", "title": "Request received" },
    { "id": "review", "kind": "decision", "title": "Approved?", "actor": "Reviewer" },
    { "id": "accepted", "kind": "end", "title": "Accepted" },
    { "id": "rejected", "kind": "end", "title": "Rejected" }
  ],
  "edges": [
    { "id": "a", "source": "start", "target": "review" },
    { "id": "b", "source": "review", "target": "accepted", "kind": "branch", "label": "Yes" },
    { "id": "c", "source": "review", "target": "rejected", "kind": "branch", "label": "No" }
  ]
}
```

```sh
jq '{flow: .}' flow.json > request.json
curl --fail-with-body http://localhost:8080/api/flows/validate \
  -H 'Origin: http://localhost:8080' -H 'X-Pathways-Client: 1' \
  -H 'Content-Type: application/json' --data-binary @request.json
curl --fail-with-body http://localhost:8080/api/flows \
  -H 'Origin: http://localhost:8080' -H 'X-Pathways-Client: 1' \
  -H 'Content-Type: application/json' --data-binary @request.json
```

After a lost response, read the chosen ID before retrying a create. Existing IDs
are never overwritten by POST. For edits, GET the latest snapshot, modify its
`flow`, and PUT the snapshot's `revision` with the updated definition. The URL and
definition IDs must match. Validation failures return 400 with issues containing
`path` and `message`; requests over 2,000,000 bytes return 413.

## Definition reference

The authoritative schema and graph checks are in
[`lib/application-flow.ts`](../lib/application-flow.ts). Unknown fields are rejected.
IDs are 1–100 characters: letters, digits, underscores, or hyphens, starting with
a letter or digit. Node and edge IDs must each be unique within a definition.

| Object | Required fields | Optional fields and defaults |
| --- | --- | --- |
| Flow | `version: 1`, `id`, `name`, `nodes`, `edges` | `projectId: null`, `description: ""`, `notes: []` |
| Node | `id`, `kind`, `title` | `actor: ""`, `description: ""`, `checks: []`, `phase: ""`, `timer`, `subflowId` |
| Edge | `id`, `source`, `target` | `label: ""`, `kind: "next"`, `retry` |
| Timer | `mode`, `expression` | Mode is `deadline`, `duration`, or `schedule`; expression is descriptive text |
| Retry | `maxAttempts`, `backoff` | 1–100 attempts; backoff is descriptive text |

Node kinds: `start`, `human`, `process`, `decision`, `api`, `database`, `timer`,
`subflow`, `end`. Edge kinds: `next`, `branch`, `error`, `retry`.

There must be exactly one start and at least one end. All steps must be reachable
from the start and have a path to an end without using retry edges. The forward
graph must be acyclic; cycles require explicit, bounded retry edges returning to
an earlier step. Start nodes have no incoming edges; end nodes have no outgoing
edges. Decisions require at least two outcomes with distinct, nonempty labels.
Branch, error, and retry edges all need labels. Self-loops are rejected.

Timer nodes require `timer`; other kinds cannot carry it. Only retry edges carry
`retry`. Only subflow nodes carry `subflowId`. Subflow links are navigation: the
target may be created later, and validation does not resolve cross-flow links or
interpret them as executable calls. A direct self-reference is rejected.

Limits: 2–250 nodes, 1–600 edges, 120-character names/titles/edge labels,
6,000-character descriptions, 30 notes of up to 2,000 characters, 20 checks per
node of up to 1,000 characters, 100-character actors/phases, 500-character timer
expressions, and 300-character backoff descriptions. Split large models into
linked flows and phases for readability.

## Storage compatibility

SQLite schema 4 adds persistent display positions to the application-flow table.
Schema-1, schema-2, and schema-3 databases upgrade without rewriting existing
roadmaps, templates, or flow definitions. Legacy ungrouped flows read as Unassigned;
existing lists retain their previous order. Older application versions reject
schema 4, so take a full database backup before upgrading. A flow save or reorder
never changes the roadmap workspace revision. Full SQLite backups include display
order; individual flow JSON exports contain only the definition, and imports
append to the selected project's list. Flow deletion and automatic merging of
conflicting flow edits are not provided.
