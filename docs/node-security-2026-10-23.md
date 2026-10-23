# Node runtime security verification — October 23, 2026

Node 22.23.4 fixes the October 21 security issues, including CVE-2026-111497. Sources: [Node.js security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [22.23.4 release notes](https://nodejs.org/en/blog/release/v22.23.4).

Docker dependency and runtime stages share the exact Node image tag and verified
multi-platform digest. CI reads `.nvmrc`; root manifest/lockfile engines require
`>=22.23.4 <23`. No application code or dependency versions changed.
See [runtime maintenance](node-runtime.md).

## Source and review

- Repository: [hooman8/pathways-local](https://github.com/hooman8/pathways-local).
- Branch: `codex/node22-security-20261023`.
- Tested runtime source commit: `5265a4d4bf20d9dca8ff93b84e0f84c20e4b6a81`, verified on the remote branch.
- [PR #8](https://github.com/hooman8/pathways-local/pull/8) remains open for review; no automatic merge was performed.
- [CI for the tested commit](https://github.com/hooman8/pathways-local/actions/runs/39956685873) passed on Node 22.23.4, including Docker Compose build.

## Validation

| Check | Result |
| --- | --- |
| Unit tests | 122 passed on Node 22.23.4 |
| TypeScript and webpack production build | Passed |
| Production integration suite | 16 passed using a disposable SQLite database and OS-assigned port in an isolated Docker network |
| Final Docker image | Built and measured Node v22.23.4 |
| Final image smoke | Health, home, architecture, flows, and synthetic workspace returned 200 |
| Lint | **Known baseline failure: 9 errors, 18 warnings; no new diagnostics** |

The complete lint output is byte-for-byte identical for pre-patch application
commit `07a541b` and the patched source under Node 22.23.4. Its matching SHA-256 is
`da32e95e4eab8a3c63aeb6bda28b0a7526fa9ee29decb9048a19258b1c075d75`. No unrelated application lint fixes or suppressions were added.
Integration coverage includes saved workflows and diagrams, portability, local
access and CSRF protection, stale writes, AI/agent mocks, and persistence after restart.

## Existing local installation

- Container: `pathways-local-app-1`, recreated through its existing Compose project.
- Runtime: **22.23.3 → 22.23.4**, measured with `docker exec … node --version`.
- Old image ID: `sha256:df60d3c2c4661e6675a7c2f05aebaca6002190609d9dfe77c67f2294ee836b98`.
- New image ID: `sha256:438ea69644a4bbd9af578ac3b8b016f566df23dea51e247aecb2bf1e4f4a342a` (the tested linux/arm64 image).
- Existing named volume: `pathways-local_pathways-data`, retained at `/data`.
- Existing `127.0.0.1:8080` binding and all environment values were preserved,
  except the image's expected `NODE_VERSION` change.
- Compose health became healthy. Health, home, architecture, flows, and workspace
  checks returned 200 without requesting AI generation or editing user records.
- An exact full-data backup was made while the old container was stopped:
  `backups/node22-security-20261023/data` in the canonical local checkout.
  The backup directory is private and excluded from Git; it may contain saved credentials.
- All saved database records and non-database settings files had identical
  before/after fingerprints. No database or diagram migration was introduced.
- Recovery image tag: `pathways-local:before-node22-security-20261023`.

The Docker image ID identifies the tested and running local artifact; it is not a
published registry manifest digest. Other installations must rebuild/restart their
own containers using the reviewed patch, preserving their data volumes. Do not use
`docker compose down -v` as part of this update. See [operations](deployment.md).

## Managed development copies

Only the runtime pins were aligned in these older work copies, on separate
checkpoint branches. Existing application changes and untracked files were
preserved; all listed commits were verified on the remote. They are not substitutes
for the fully tested canonical release branch.

| Development copy | Checkpoint branch | Remote-verified commit |
| --- | --- | --- |
| flow-api | `codex/node22-pin-flow-api-20261023` | `6d5826bd9c3b673687bea071a1ba5ab8f48f5989` |
| local-parity | `codex/node22-pin-local-parity-20261023` | `3b4b1677bb65fbf5f702cbf31c13517e2ef3d3a8` |
| presenter-notes | `codex/node22-pin-presenter-notes-20261023` | `b5bfb7f30a8adc8415536b64d1d6acdda81d3374` |

Old dependency directories and cached images still require rebuilding before use.
Default main remains pending PR review/merge. This patch does not upgrade Next.js
or other npm dependencies and does not claim that all application security findings
or lint errors have been resolved.
