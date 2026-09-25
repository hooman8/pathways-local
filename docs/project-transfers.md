# Complete project transfers

[Documentation home](../README.md)

Both the local Docker edition and the hosted edition read and write the same
version-1 `pathways-project-bundle` JSON file. In **Application flows**, select a
project and choose **Export complete project**. On another instance, choose
**Import complete project**, select the file, review the name and ordered flow
list, then choose **Import as new project**. Both instances must include this
feature. The installations remain independent; imports do not synchronize them.

The file includes the project roadmap, progress, decisions, assignments, associated
engineers and teams, every application-flow definition, saved display order, and
links between those flows, and per-flow presenter write-ups. It excludes sign-in accounts, roles, sessions,
workspace templates, other projects, and server revision history. Use the separate
workspace/template export or an operational database backup when those are needed.
The older roadmap-only exports still work but do not include application flows.

Import generates fresh project, task, and flow IDs and remaps internal references.
Existing projects are never overwritten. Engineer/team entries are merged by the
existing project import rules. A duplicate project name receives an `(imported N)`
suffix. Detail links to flows outside the exported project are disclosed in the
preview and disconnected on import; their step descriptions remain. Transfer the
associated projects separately and reconnect those links explicitly if needed.

The local owner can export and import. On the hosted edition, members can export
projects they can view; only workspace owners can import complete projects because
the import may add shared team and engineer entries. Accounts and permissions are
always configured on the destination instance.

## API

| Method | Request | Result |
| --- | --- | --- |
| `GET /api/project-bundles?projectId=<id>` | Normal edition-specific access checks | Complete JSON bundle |
| `POST /api/project-bundles` | `{ bundle, revision, importId, name? }` | 201 `{ project: { id, name, flowCount }, flowIds, warnings }` |

Read the current workspace revision from `GET /api/projects` and generate a UUID
for `importId`. Writes require JSON and the existing origin/client-header checks;
the hosted edition also requires its signed-in session. Use a new import ID for
each intentional new copy. Retrying the same ID and content returns the original
result even after a lost response, without duplicating the project. Reusing an ID
for different content is rejected. A stale workspace revision returns 409; refresh
and retry after reviewing the change, retaining the same import ID and file.

The roadmap, directory changes, flows, order, and import receipt commit together
or none do. SQLite uses a transaction; the hosted edition uses a Firestore
transaction that rechecks the caller's current membership. Exports also read a
consistent snapshot.

Limits: 5,000,000 bytes per bundle, 200 flows per project transfer, 750,000 bytes
per flow, and the existing project/workspace limits. Invalid graphs, references,
foreign-project flows, repeated IDs, unknown top-level fields, and incomplete flow
orders are rejected. Keep exported business data outside source repositories.

The common validators, ID mapping, and transfer UI are in `lib/project-bundle.ts`,
`lib/project-transfer-request.ts`, and `components/flows/project-transfer.tsx` in
both editions. Storage and authentication stay specific to each edition.
