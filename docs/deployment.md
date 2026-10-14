# Docker and local operations

[Documentation home](../README.md)

## Start and update

Start Docker Desktop, then run `docker compose up -d --build` from this repository.
Open `http://localhost:8080`. The first build needs internet to download the base
image and npm packages. The core runtime needs only the local browser, container, and volume; optional Astra generation also needs internet access and your own key.
The image runs as the non-root `node` user and owns `/data`.

To update:

```sh
git pull --ff-only
docker compose up -d --build
```

The image contains code, not your database. Ordinary rebuilds and container
replacements reuse the named volume. Back up before upgrading. Never run
`docker compose down -v` unless intentionally deleting your workspace.

## Configuration

Compose supplies `APP_BASE_URL=http://localhost:8080` and
`PATHWAYS_DB_PATH=/data/pathways.sqlite`. Set `PATHWAYS_PORT` to choose another
host port; Compose updates the application origin at the same time.

```sh
PATHWAYS_PORT=8081 docker compose up -d --build
```

The host binding is deliberately `127.0.0.1`. Do not change it to `0.0.0.0`, add
public ingress, or publish a tunnel. This edition has automatic owner access and
is intended for one person on one computer. It does not provide remote-user login.

## Data and backups

The named volume is `pathways-local_pathways-data`. SQLite stores the complete
workspace, templates, local owner metadata, revisions, and application flows in `/data/pathways.sqlite`.
WAL and shared-memory sidecar files may also exist.

For a portable content backup, use **Export → Export workspace & templates** in the
application. Import that JSON into another installation to add the saved projects,
templates, teams, engineers, and progress. This is also the migration route from
the original cloud application. It does not synchronize the two copies.
Application flows have their own **Export** and **Import flow** actions. Workspace
JSON exports omit them; a full database backup includes all flows and roadmaps.

The complete-project update migrates SQLite schema 1 through 5 to schema 6 when the
database is first opened. It preserves existing content and display order; older
ungrouped flows appear in Unassigned until moved to a project. Older images reject schema 6, so keep a pre-update backup if you need to roll back the application version.

For an exact database backup, stop writes and copy the entire data directory:

```sh
mkdir -p backups
docker compose stop app
docker compose cp app:/data ./backups/pathways-snapshot
docker compose start app
```

Use a new destination directory for each backup. Copy the complete directory,
including any SQLite sidecars; do not copy only a live database file. Keep a second
copy outside Docker Desktop and the repository. The `backups/` and `data/`
directories are ignored by Git and excluded from the Docker build context.

To inspect or restore an exact backup, keep the original volume intact and test a
separate installation using a copy of that data directory. The application process
must have write access to the copied directory and files (container UID/GID 1000).
For most personal transfers, JSON export/import avoids filesystem ownership issues.

Docker volume deletion, Docker Desktop factory reset, or uninstalling its data can
remove the database; the container image cannot restore it.

## Health and troubleshooting

`GET /api/health` checks that the process responds. It does not validate the database.
The Compose healthcheck runs inside the container. Check workspace loading and a
saved edit after updates. View errors using `docker compose logs app`.

On startup, a newer unsupported database schema is rejected. Restore the matching
application version or use a compatible backup; do not manually lower the SQLite
schema version. A code rollback does not undo database edits.

The application has no cloud resources to provision. Optional Astra uses your own OpenAI API account and billing; no Pathways subscription is required.

Use **Export complete project** for a portable project with both its roadmap and
ordered application flows. See [project transfers](project-transfers.md).

## Optional Astra configuration

Prefer **AI settings** in the app. It saves the key as `/data/ai-credentials.json` with mode 0600, next to the SQLite database, and never returns it through settings responses. Project/workspace exports omit it. Full data-directory backups contain the key and conversations: keep those backups private. Removing the saved key does not remove project content.

Alternatively copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and recreate the container. Compose passes this server-only variable; it takes precedence over a UI-saved key. `OPENAI_MODEL=gpt-6-astra`, `OPENAI_REASONING_EFFORT=high`, and `OPENAI_MAX_OUTPUT_TOKENS=128000` are the supported defaults. `PATHWAYS_OPENAI_ENABLED=false` disables generation without deleting the key. Never prefix credential variables with `NEXT_PUBLIC_` or commit `.env`.

Astra jobs have a 15-minute deadline and run within this one application process. A queued job resumes when its conversation is read; a job interrupted after being claimed expires and can be retried with a new message. Saved diagrams remain intact. Local agent authoring does not call OpenAI or require these settings.
