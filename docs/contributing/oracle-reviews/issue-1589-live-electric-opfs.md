# Issue #1589 live Electric OPFS oracle review

- Reviewed implementation and oracle commit: `2c5e83cb2f448d214e86f67c96557553d936acc4`.
- Comparison main: `8df353a68b841ce55f76230b1197c3bf580d43fe`.
- Executable owner: `packages/browser-db-sqlite-persistence/e2e/electric-resume-two-tab.opfs.spec.ts`.
- Controlled order witness: `packages/browser-db-sqlite-persistence/tests/browser-coordinator.test.ts`.

## Contract and observed histories

Issue #1589 reports two connected failures. Collections with different schema
versions can route a write through the wrong adapter and reset each other's
rows. A stale Electric resume marker can then certify an empty local baseline
as ready. The current contract requires each Collection to keep its own schema
and durable rows. An incomplete baseline cannot authorize a non-initial
Electric cursor.

The fixed browser grammar has two Collections with schema versions 1 and 2.
Each has an independent PostgreSQL table. A Chromium leader loads both. A
follower opens the same OPFS database, then takes leadership. The test adds a
source row to each table and checks public and durable rows. It next creates
one of two legacy pre-key-ledger states for Collection A: one lost row or all
rows lost. Both states retain the old resume marker. On reopen, Collection A
must request a fresh Electric snapshot from offset `-1` and recover the exact
PostgreSQL rows. Collection B must retain its rows throughout the history.

The independent expected result comes from the test's PostgreSQL row list.
The test compares complete sorted public and durable rows at each settled
checkpoint. It also compares schema versions, leader state, reset epochs, and
the first recovery request. An unchanged reset epoch detects a destructive
schema reset during the checked follower-open and takeover history. This test
does not sample transient public states between those checkpoints.

An ordinary source commit has a separate order law: it enters the shared
regular scheduler before it requests the database-wide writer lock. The
controlled Browser test sends a real wrapped Collection commit through the
coordinator. It records scheduler entry, writer-lock request, persistence
apply, and scheduler exit in that order. The live OPFS histories then check
progress with the real scheduler, Web Locks, worker, and Electric provider.

## RED and GREEN evidence

During initial live-host development, the recovery history timed out before
the lock-order repair. One writer lock was held while another request waited.
That observation is a timeout, not a row-assertion failure. The development
run did not retain an immutable pre-fix oracle commit, so this record does not
use it as the only checker calibration.

At the reviewed commit, the controlled source-commit test passed with the
exact four-event order above. A temporary mutant restored the old call-site
bypass by passing `this.persistence.adapter` into
`applyBufferedSyncTransactionUnsafe`. The test then failed at the intended
order assertion. It observed `writer-lock-request, apply` without scheduler
entry or exit. The mutant was removed before verification.

The full Browser coordinator suite passed 154 tests. The live Chromium suite
passed both recovery histories and two failure-fidelity tests. Each recovery
history also passed four repeat runs in addition to focused runs. The package
TypeScript check, changed-file ESLint, Prettier, and `git diff --check` passed.
ESLint reported only warnings on unchanged lines in the coordinator suite.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: contract authority and limits | Pass for the bounded #1589 browser history. The reporter's rows-plus-resume failure supplies the example. Existing persistence and Electric contracts supply the row, schema, and cursor laws. The test does not establish React rendering, Firefox/Zen, React Native, arbitrary large datasets, or exclusive OPFS ownership. |
| ORC-002: independent judgment | Pass. The expected rows come from the PostgreSQL fixture data, not the SQLite snapshot or Electric response. The expected recovery offset is the initial Electric snapshot offset, not a persisted cursor read back from production. |
| ORC-003: distinguishable responsibilities | Pass. The spec states the row and resume laws, two fixed loss histories, real browser driver, and settled public/durable checks. The companion browser fixture supplies OPFS and Electric. The controlled coordinator test owns the order assertion. |
| ORC-004: generated-history grammar controls | Not triggered. The suite enumerates two fixed loss cases and makes no generated-history coverage claim. The cases distinguish partial from total baseline loss. Neither case permits a missing resume marker. |
| ORC-005: production path and observation | Pass. Two real Chromium pages use OPFS, Web Locks, BroadcastChannel, PostgreSQL, and the installed Electric SDK. The test observes exact public and durable rows, ready status, schema versions, reset epochs, leadership transfer, and recovery request offset. The controlled test reaches the wrapped source-commit call site and the writer-lock request. |
| ORC-006: checker calibration | Pass for the order law. The old-bypass mutant reached persistence apply and failed at the exact event-order assertion. The earlier live pre-fix run timed out and is classified separately as a progress failure. The host test does not prove every row assertion rejects a separate mutant. |
| ORC-007: fixed/random campaigns and replay | Not triggered. These are fixed host histories, not an important generated property. The table names and database IDs vary only to isolate test resources. |
| ORC-008: stateful-model minimality | Not triggered. The test adds no stateful reference model. The PostgreSQL row list is fixed expected data. |
| ORC-009: vocabulary mapping | Pass. Source rows, public rows, durable rows, Collection readiness, leadership, resume marker, and writer lock keep their production meanings. The test-only event list records call order; it does not model scheduler state. |
| ORC-010: failure fidelity and cleanup | Pass for the tested failure modes. An injected diagnostic failure leaves the navigation error as the cause. Injected cleanup and fallback-close errors remain separate. The harness attempts page cleanup, drops both PostgreSQL tables, and closes the client. An `AggregateError` preserves a primary test failure as its cause when cleanup also fails. A process crash remains outside this guarantee. |
| ORC-011: independent second formulation | Not triggered. No plausible shared semantic fault between the fixed PostgreSQL expectation and the SQLite/Electric result was identified. Mocked Electric recovery tests provide a different boundary, not a substitute for this live host path. |

ORC-012 is satisfied by this versioned record and the exact reviewed commit.
The review supports only the named two-tab Chromium history and controlled
order law. It does not close every #1589 environment or the separate
exclusive-handle topology question. The issue should remain open until the PR
lands and maintainers decide whether the remaining host limits need follow-up.
