# Endpoints investigations

Three independent probes for the approved RFC v0.18 Todo investigations.
Baseline: `68366ecaeef6c12a13402b558bd4a68d7519442f`.

| Directory | Owner | Boundary |
| --- | --- | --- |
| `track-a-analysis` | Analysis worker | Drizzle/PG extraction, key/order evidence, source repair and unsupported cases |
| `track-b-compilation` | Compilation worker | Start types, actual requests, browser exclusion, edits and optimistic callback |
| `track-c-agent-feedback` | Agent feedback worker | Cited LSP support matrix and observed diagnostic delivery |
| `integrated-todo` | Todo worker | Authored app, generated compiler/runtime wiring, persistence and browser acceptance |

Each directory owns its dependencies and fixture output. These standalone
probes are outside the pnpm workspace package globs. The coordinator owns this
index and any shared configuration. Existing application packages are not
part of the probe implementation.

The first pass is independent: A analyzes fixture source, B may author metadata,
and C produces synthetic diagnostics. Fixture success does not establish the
integrated Todo, shared protocol, authentication, SSR binding or mutation
settlement. Reports distinguish observed passes, failures and untested claims.

The current worktree replaces the historical workspace named in the briefs.
The existing Field Log is maintained through its writer at
`/Users/kylemathews/programs/dialectics/field-trip-tanstack-db-endpoints-prototype`.

## Initial reports

- [A: source analysis and PostgreSQL evidence](track-a-analysis/README.md)
- [B: Start compilation and runtime](track-b-compilation/phase-1/README.md)
- [C: agent support and diagnostic delivery](track-c-agent-feedback/REPORT.md)

## Red/green follow-up

- [A: common SQL checking, schema evidence and source repair](track-a-analysis/phase2/README.md)
- [B: compiler safety and source maps](track-b-compilation/PHASE-2.md)
- [C: actual analyzer delivery and coding-agent repair](track-c-agent-feedback/phase2/REPORT.md)

Raw SQL and Drizzle-derived SQL now share a bounded checker. Compiler probes
reject declared server-only modules and test source-map/error-response leakage.
Actual analyzer findings reached successful CLI and native MCP repair loops.
Three native LSP trials published findings without observed model receipt.
See each report for exact red/green evidence, versions, commands and limits.

## Integrated Todo phase

Kyle authorized building the integrated Todo and continuing the LSP investigation.
The earlier stop-before-integration boundary is superseded. The bounded app
uses actual Query Collections, optimistic transactions and disposable
Drizzle/PostgreSQL persistence, with a CLI diagnostic path.
The reports state the authoring, schema, scope and import-policy
assumptions; those choices are prototype contracts, not a settled public API.

- [Working Todo, run commands and browser evidence](integrated-todo/README.md)
- [A3: actual app source, SQL/schema correspondence and repair](track-a-analysis/phase3/README.md)
- [B3: independent integrated compiler safety](track-b-compilation/phase3-validation/README.md)
- [C3: native LSP receipt, controlled explanation and actual repair](track-c-agent-feedback/phase3/REPORT.md)

Dev and production browser tests cover delayed optimistic settlement, targeted
refetch, rejected-write rollback and recovery after a post-write read failure.
An actual callback-error regression now proves partial optimistic changes roll
back before any RPC. The live authored-query repair loop produces a diagnostic,
applies its edit, refuses stale runtime evidence and clears with a fresh capture.
The LSP follow-up explains the earlier negative: this Claude Code version gates
automatic diagnostic attachments on Bash or PowerShell availability. A matched
positive control and actual analyzer repair passed using only Read/Edit calls.
An empty diagnostic clear still did not provide the model an affirmative pass.
