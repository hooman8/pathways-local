# Local development

[Documentation home](../README.md)

Use Node.js 22.13+ and npm. CI and Docker use Node 22. The built-in SQLite module
is available without an extra native database package; Node 22 may print its
experimental-module warning. No Google project, emulators, or Java are required.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The first load initializes a sample workspace in
`data/pathways.sqlite`. No `.env.local` is required. Optional settings:

| Variable | Default for development | Purpose |
| --- | --- | --- |
| `APP_BASE_URL` | `http://localhost:5173` | Exact browser origin; must use a loopback hostname |
| `PATHWAYS_DB_PATH` | `data/pathways.sqlite` | Database file, relative to the working directory or absolute |
| `NEXT_TELEMETRY_DISABLED` | Set to `1` in Docker | Disable Next.js telemetry when developing locally |

Copy `.env.example` to `.env.local` if overriding settings. Keep local data and
environment files untracked. Docker Compose provides its own environment and
stores its database in a separate named volume.

## Validation

```sh
npm test
npm run check
npm run build
npm run test:integration
```

`npm test` bundles the domain and SQLite tests with esbuild and runs Node's test
runner. It covers task rules, templates, merges, origin checks, disk persistence,
and writes across independent SQLite connections. Add new unit test files to
`scripts/test-roadmap.mjs`.

The integration runner requires a production build. It starts a server on an
OS-assigned loopback port and creates a fresh database in the system temporary
directory. It tests local access, CSRF/Host checks, import/export-compatible data,
stale saves, templates, validation, and a complete server restart. It cleans up
its server and data afterward. It never uses your saved workspace.

`npm run lint` is available as an additional check; inherited UI scaffold lint
issues are outside the current CI gate. `npm run install:ci` is the inherited
alternative installer for systems with conflicting global libvips installations.

## Production container

```sh
docker compose up -d --build
```

Open `http://localhost:8080`. See [operations](deployment.md) for data and backups.
After `npm run build`, `npm start` is also supported without Docker; its default
origin is `http://localhost:8080`. Keep it bound to loopback for personal use.

| Symptom | Check |
| --- | --- |
| Workspace request returns 403 | Use the exact URL in `APP_BASE_URL`; localhost and 127.0.0.1 differ |
| SQLite cannot open the database | Check directory permissions and `PATHWAYS_DB_PATH` |
| SQLite is locked | Avoid multiple independent app installations sharing a database file |
| Port 8080 is in use | Set `PATHWAYS_PORT=8081` when running Compose |
| Integration tests request a build | Run `npm run build` first |
| Save returns 409 | Resolve the conflicting tab edits or export the draft before reloading |

Import `examples/roadmap.json` for a synthetic decision workflow. The fixture and
sample roadmap contain no cloud workspace data.
