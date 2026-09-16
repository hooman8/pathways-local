# Contributing to Pathways Local

Thanks for helping improve Pathways Local. Start with the [README](README.md),
[development setup](docs/development.md), and [architecture map](docs/architecture.md).
You can install, test, and build the source without any cloud services.

## Propose and develop a change

1. For a substantial feature, open an issue describing the problem and intended
   behavior. Use synthetic examples, not exported work projects or credentials.
2. Fork the repository, clone your fork, and create a descriptive branch (for
   example `codex/improve-template-picker`). Run `npm ci`.
3. Keep domain rules in `lib/`, permissions in `WorkspaceStore`/API checks, and UI
   interactions in `components/roadmap`. Validate untrusted data on the server.
4. Add meaningful regression coverage when changing task semantics, graph routing,
   merges, permissions, or persistence. Update affected documentation and examples.
5. Open a pull request explaining the problem, resulting behavior, and checks run.
   Include screenshots for UI changes and compatibility notes for schema changes.

## Validation

```sh
npm test
npm run check
npm run build
```

For auth, persistence, or API changes, run `npm run test:integration` after building; see
[Development](docs/development.md). CI runs these checks for pushes and pull
requests. `npm run lint` is also available but is not currently a CI requirement.
Run unit/integration suites sequentially; they share a temporary output directory.
A new unit test file must be added to the imports in
[scripts/test-roadmap.mjs](scripts/test-roadmap.mjs) to be executed by `npm test`.

For documentation-only changes, check relative links, shell examples, and factual
claims against the source. An application deployment is unnecessary.

## Compatibility expectations

Persisted data and tabs left open across releases must remain safe. When adding a
field, review schema defaults, copy/reset behavior, exports/imports, three-way
merges, API capability checks, and SQLite state writes. Never silently
drop unknown-to-an-old-client content. Preserve the localhost request boundary and atomic revision checks.

Task-array ordering is separate from dependency order. Graph-layout fixes should
preserve workflow semantics. Avoid changing stored state just to make a diagram
look different. See [Data model](docs/data-model.md) for required invariants.

Use the existing TypeScript/React style and UI primitives. Avoid unrelated
reformatting or dependency changes. Commit `package-lock.json` with dependency or
package-metadata updates; do not commit generated builds or local environment files.

## License and reporting

Contributions are provided under the repository's [MIT License](LICENSE). Preserve
third-party notices and do not contribute code or data you cannot distribute.
Use [GitHub issues](https://github.com/hooman8/pathways-local/issues) for ordinary
bugs and requests. Follow [SECURITY.md](SECURITY.md) for private vulnerability
reports. Be respectful, describe reproducible behavior, and discuss the change
rather than the person proposing it.
