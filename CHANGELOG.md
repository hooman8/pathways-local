# Release notes

## Unreleased

- Architecture layouts leave enough space for connection labels between component
  columns and system groups, preventing a blank canvas for valid dense diagrams.
- Fit View and manual zoom can show the complete architecture when its system
  groups are wider than the viewport, while initial views keep components readable.

## 1.1.0

- Architecture view with grouped components, labeled relationships, true two-way
  arrows, component details, focused groups, expanded diagrams, and presenter notes.
- Same version-1 workflow/architecture and complete-project format as the hosted
  Architecture release. Bidirectional contract tests preserve definitions, order,
  links, notes, and progress; older workflow files remain supported.
- Optional Astra through the OpenAI Responses API with a user-supplied API key,
  local conversations/jobs, validated drafts, refinements, and atomic Apply.
  No Pathways managed AI subscription or cloud infrastructure is required.
- AI settings to save, replace, or remove a local key. Keys stay server-side and
  are excluded from portable exports; environment configuration remains optional.
- Discoverable local agent API and CLI for complex workflows and architecture,
  with review links, idempotent proposals, revision conflict checks, and atomic
  multi-diagram Apply. Agents do not need to give Pathways a provider key.
- SQLite migration to schema 6 adds authoring storage without changing existing
  project/flow definitions. Back up before updating; older images reject schema 6.

Roadmap planning, decisions, teams, templates, local saves, and one-user localhost
access remain available without a key or internet connection.
