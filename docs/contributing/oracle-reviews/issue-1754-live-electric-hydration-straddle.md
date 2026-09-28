# Issue #1754 live Electric hydration-straddle oracle review

- Reviewed oracle commit: `1ad6fcef9c705d2d3edb4d8003ba116e8a878ea0`.
- Comparison main: `f09868ffba3ea401a9b182cc90282435bf832e3c`.
- Executable owner: `packages/browser-db-sqlite-persistence/e2e/electric-hydration-straddle.opfs.spec.ts`.
- Host: Chromium with PostgreSQL, Electric, Web Locks, and the OPFS worker.

## Contract and fixed history

Issue #1754 reports a source transaction that begins during persisted hydration
and commits after the hydration scope closes. A late commit must apply and settle.
It must not enter a hydration buffer whose flush already ran. The existing core
persistence tests cover this rule with a controlled adapter. This test adds a
live Electric and OPFS host witness.

The fixed history starts with one PostgreSQL row and loads it through an
on-demand Electric Collection. The test then starts a second subset demand for
an absent key. It holds that demand after the OPFS subset read, while the
persisted hydration scope remains active. A PostgreSQL update starts a real
Electric source transaction during the hold. The fixture parks its row-bearing
commit. The test releases hydration, observes the scope exit and the unchanged
old row, then releases the commit. The expected new row comes from the
PostgreSQL update. The test compares complete public and durable rows after the
commit, after follower takeover, and after reopen.

The empty subset demand cannot deliver the updated key through its own remote
snapshot. The source transaction is the only tested path for that update. The
reach flags distinguish fixture setup from the reported straddle: the source
began during the hold, its row commit was parked, and the hydration scope exited
before the commit was released.

## RED and GREEN evidence

The final test passed four focused repeats. The full live Electric suite passed
twice, with 10 of 10 tests green. TypeScript, changed-file ESLint, Prettier, and
`git diff --check` passed.

A temporary mutant removed `&& runtime.isHydratingNow()` from the late-commit
condition in `packages/db-sqlite-persistence-core/src/persisted.ts`. The mutant
queued the transaction after hydration closed. The focused browser test reached
all timing flags, including a settled empty subset demand. Its updated-row poll
then timed out with the old row in both public and durable state. This is an
assertion timeout at the intended settled checkpoint, not a setup failure or an
unreached path. The mutant was removed. The focused browser test passed again.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass for the fixed #1754 live-host history. The issue supplies the reported begin/commit straddle. Existing core persistence tests and Collection sync settlement supply the law. This does not prove Firefox/Zen, eager startup, other mutation shapes, or arbitrary Electric fetch schedules. |
| ORC-002: independent judgment | Pass. PostgreSQL fixture values define the old and new rows. Neither the Electric stream nor the persisted SQLite snapshot computes the expectation. |
| ORC-003: responsibilities | Pass. The spec states the contract, fixed history, public and durable checkpoints, and limits. Its named companion fixture drives the real source, hydration scope, and OPFS adapter. |
| ORC-004: generated grammar | Not triggered. This is one fixed history with unique resource IDs, not a generated-history coverage claim. |
| ORC-005: production path and observation | Pass. The real Electric source calls the persisted wrapper. Reach flags prove begin during hydration and commit after scope exit. Exact public and durable rows are checked before release, after settlement, after leadership transfer, and after reopen. |
| ORC-006: calibration | Pass. The old late-buffer decision left the original row in both observations at the intended checkpoint. The failure was an assertion poll timeout with every required timing flag reached. |
| ORC-007: fixed/random replay | Not triggered. The test has no important generated property. Random IDs isolate resources, but do not generate semantic histories. |
| ORC-008: model minimality | Not triggered. The test adds no stateful reference model. |
| ORC-009: vocabulary | Pass. Hydration scope, source transaction, public rows, durable rows, and leadership use their production meanings. The test-only gates record timing and do not model product state. |
| ORC-010: failure fidelity | Pass for this harness. Cleanup releases both gates, closes the pages and database, and drops the PostgreSQL table. An `AggregateError` keeps the primary failure as its cause when cleanup also fails. Process termination remains outside this guarantee. |
| ORC-011: second formulation | Not triggered. No shared semantic classifier between the fixed PostgreSQL expectation and the Electric/SQLite implementation was identified. Core controlled-adapter tests cover adjacent settlement orders at a different boundary. |

ORC-012 is satisfied by this versioned record and the exact reviewed oracle
commit. The bounded host witness does not by itself close every environment or
history in #1754. The coverage map assigns adjacent settlement histories to
the core persistence tests and names the remaining live-host limits.
