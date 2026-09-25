# Pathways Local

[![Validate](https://github.com/hooman8/pathways-local/actions/workflows/check.yml/badge.svg)](https://github.com/hooman8/pathways-local/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A self-contained workspace for planning application onboarding and project roadmaps.
Run it on your Mac with Docker Desktop. Projects, templates, assignments, and
progress are stored in a local SQLite database. No Google Cloud, Firebase account,
API keys, or sign-in are required.

This is the independent local edition of
[Pathways](https://github.com/hooman8/pathways-roadmap), with the same dependency
maps, checklists, decisions, teams, and reusable templates.

## Start on your Mac

Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/),
then run:

```sh
git clone https://github.com/hooman8/pathways-local.git
cd pathways-local
docker compose up -d --build
```

Open **[http://localhost:8080](http://localhost:8080)**. The first visit creates a
local owner and a sample project. No configuration file is needed. Docker builds
for your Mac's architecture, including Apple silicon and Intel.

The first build downloads the Node image and npm packages. Once built, the
application runs without internet access. Fonts, icons, and scripts are bundled;
there are no cloud storage, authentication, or runtime API dependencies.

This edition is for **one local user**. Everyone who can access the service on your
computer has owner access. Compose binds the port to `127.0.0.1`; keep that binding
and do not expose the service through a public URL or network proxy. Teams and
engineers are planning labels, not separate login accounts.

## Everyday commands

```sh
docker compose stop             # Stop; keep all saved data
docker compose start            # Start again
docker compose logs -f app      # View application logs
docker compose up -d --build    # Rebuild and run after pulling an update
```

Data lives in the Docker named volume `pathways-local_pathways-data`, at
`/data/pathways.sqlite` inside the container. It survives stops, restarts,
rebuilds, and ordinary `docker compose down`. **`docker compose down -v` deletes
that volume and its data.** See [backups and operations](docs/deployment.md).

If port 8080 is occupied:

```sh
PATHWAYS_PORT=8081 docker compose up -d --build
```

Then open `http://localhost:8081`. Use that same port setting on subsequent Compose
commands. Use the exact `localhost` URL; switching to `127.0.0.1` in the browser
will fail the origin check.

## Bring your existing roadmaps

1. In the original application, choose **Export → Export workspace & templates**.
2. In Pathways Local, choose **Import** and select the JSON file.
3. Review the projects, then confirm the import.

Imports preserve progress, decisions, teams, and assignments, and add the imported
projects alongside the starter project. Accounts and access rules are not imported.
The two installations are independent; changes are not synchronized. Your data
and exports do not belong in this public repository.

## Features and stack

- Nested workstreams and substeps with an interactive dependency map and checklist.
- Yes/No decisions, conditional branches, prerequisites, and impediments.
- Shared team/engineer directory for task assignments.
- Reusable templates and JSON project/workspace import/export.
- Automatic saving, conflict detection between tabs, and durable local storage.
- Application behavior diagrams with approvals, labeled branches, timers, bounded
  retries, linked subflows, and a local API for agent-generated definitions.

**Stack:** Next.js 16, React 19, TypeScript, React Flow, ELK.js, Tailwind CSS 4,
shadcn/ui, Node.js 22, and SQLite through Node's built-in `node:sqlite` module.
Docker runs one application container; no separate database container is needed.

## Develop and contribute

With Node.js 22.13+ installed:

```sh
npm ci
npm test
npm run check
npm run build
npm run test:integration
npm run dev
```

Development runs at `http://localhost:5173` and stores data in `./data/pathways.sqlite`.
Integration tests use an isolated temporary database and test a production build,
including a server restart. No cloud credentials, emulators, or Java are needed.

| Topic | Guide |
| --- | --- |
| Local development and checks | [Development](docs/development.md) |
| Storage, API, and code map | [Architecture](docs/architecture.md) |
| Task rules and compatibility | [Data model](docs/data-model.md) |
| API and localhost request checks | [API reference](docs/api.md) |
| Application diagrams and agent authoring API | [Application flows](docs/application-flows.md) |
| Docker, updates, and backups | [Operations](docs/deployment.md) |
| Using the roadmap | [User guide](docs/user-guide.md) |
| Contributions and security | [Contributing](CONTRIBUTING.md), [Security](SECURITY.md) |

One installation serves one workspace, with up to 100 projects, 100 templates, and
120 tasks per roadmap. The app must be running to edit; it is not an offline browser
PWA. There is no multi-user login, cloud synchronization, audit history, or undo.

## License

[MIT](LICENSE). Original Pathways and third-party notices are preserved; see
[third-party notices](THIRD_PARTY_NOTICES.md). `private: true` in `package.json`
prevents accidental npm publication and does not make this repository private.
