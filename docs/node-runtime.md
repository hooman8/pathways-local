# Node.js runtime

Both Pathways editions use **Node.js 22.23.4**. This is the Node 22 security
release for the [October 21, 2026 advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including CVE-2026-111497. See the [release notes](https://nodejs.org/en/blog/release/v22.23.4).

- `.nvmrc` selects the development and GitHub Actions runtime.
- `package.json` and the root lockfile entry require `>=22.23.4 <23`.
- Both Docker stages use the same `NODE_IMAGE` argument, pinned to 22.23.4 and
  the verified multi-platform image digest. Do not override it with an older image.
- Application dependency versions are unchanged by this runtime patch.

Use `nvm install && nvm use` if nvm is installed, or install Node 22.23.4 using
your normal version manager. Verify `node --version` before running the checks in
[Development](development.md). The package engine requirement describes supported
versions; it does not replace an already installed runtime.

For future security releases, verify the official advisory, update `.nvmrc`, the
Docker version/digest, and both root engine declarations together in each edition.
Keep the two editions' runtime pins aligned without copying their application code
or environment files. Run unit, lint, TypeScript, build, and integration checks on
the selected runtime and verify `node --version` inside the resulting image.

Existing containers and Cloud Run revisions keep their original runtime until
rebuilt and replaced. Follow [Deployment](deployment.md), preserve environment
settings and data volumes/databases, and verify the active immutable image after
rollout. CI does not deploy the hosted service.
