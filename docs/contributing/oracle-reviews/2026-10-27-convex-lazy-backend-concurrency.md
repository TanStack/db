# Convex lazy concurrency at the real backend

This record closes the real-backend receipt/version receiving boundary left in
the [interleaving follow-up](2026-10-27-convex-lazy-interleavings.md).
The scientific models are unchanged. A new receiver uses the actual isolated
Convex backend, both real SDK clients, real opaque server cursors, actual core
commit receipts and real optimistic transactions. Its source binding is the
[manifest](2026-10-27-convex-lazy-backend-concurrency-source.json).

## Law and receiving path

`LoadSubsetFn`, `LoadSubsetOptions.signal` and `SyncAppliedReceipt` in
`packages/db/src/types.ts` require successful loads and canceled uncancelable
accepted work to wait for their establishing writes to apply. A cached caller
can owe zero new receipts, and can still wait behind unrelated held work. The
fixed-query coherent SDK premise and atomic publication require a fully acquired
source to publish coherent authored relations in monotone revision order.
Stuttering and skipped intermediate revisions remain permitted.

`e2e/lazy-concurrency-oracle.test.ts` receives these laws through the public
paginated factory and real Collection. `LazyReceiptModel` owns facts and exact
establishing obligations; `LazyVersionModel` owns authored relations and the
compatible monotone revision frontier. The new driver has no independent
expectation derived from production's page chain, sealing state or queue.

The server fixture adds `tasks:revise`, an atomic full-table text update with
stable keys/ranks. The independent ledger authors the complete expected relation
before each mutation starts; the separate unpaginated query verifies the fixture.
Updating rows in separate transactions would permit intermediate server
relations and would not test this law. SDK wrappers only record genuine results
seen by the adapter. The source-provenance comparison receives that evidence
separately from the offered revision ledger.

Each history first establishes a shallow source prefix, then starts two full
acquisitions. Required facts absent at acquisition have unique supplying native
batches, allowing one actual receipt to establish both callers. A real optimistic
transaction holds application. The shared held receipt is observed and both
callers' missing-fact sets must be empty before cancellation. The canceled
caller and successful peer remain pending until release. A cached shallow
caller owes no invented receipt; its early or delayed settlement is permitted,
and it must complete after the responsive drain.

After full acquisition applies, every source change callback checks base rows
against the unchanged version/provenance models. Two actual version-bearing
batches are accepted during another optimistic hold before application is
released. A version witness proves some unique new fact reached acceptance;
it does not impose a commit partition or claim every authored fact was written
in that batch. Application comes from actual receipt fulfillment. FIFO work may
already have advanced to a newer revision before an earlier Promise callback
runs, so the driver does not require historical rows to remain present then.

The reader then loses its real TCP connections while an independent writer
advances the server. Reconnect must eventually establish the latest authored
relation, allowing skipped intermediate revisions. The network gate forwards
uninterpreted TCP bytes and never synthesizes page data. TCP loss is a transport
fault; it does not promise a native provider-error callback.

## Generated reach

The matching fixed/random family varies 7–12 rows, page sizes 2–4, text, and
whether another revision supersedes one during disconnect. Every history runs
both real SDKs. Each lane has four top-level histories, giving sixteen complete
SDK/backend episodes across the two lanes.

Final full-suite evidence observed all eight states in all four histories in
each lane:

- `real-shared-held-receipt`
- `real-canceled-held`
- `real-cached-peer-drain`
- `real-two-revisions-held`
- `real-monotone-publications`
- `real-reconnect-latest`
- `javascript`
- `react`

Actual callback snapshots must contain both the held-drain revision and the
reconnected latest relation. Manual comparison checkpoints cannot populate that
callback witness set. Callback violations are retained and surfaced at explicit
checkpoints without throwing through production. Environmental polling also
stops when a retained semantic violation makes its target unreachable. A timeout
alone is not classified as a semantic mutant rejection. Both SDK receivers run
even after one fails, preserving each independent failure.

## RED, GREEN and hostile calibration

Unchanged production passed the extended receiver. No production defect RED or
production repair is claimed in this round. Changes are the backend receiver,
atomic test-server mutation, lazy test configuration and coverage documentation.

Two production edits were applied in isolation and restored in `finally`:

| Mutant | Semantic rejection through both SDKs |
| --- | --- |
| Remove `if (visible !== true) await visible` from the native subset wrapper | `receipt law: a settled before batch-2 applied`. Provider completion cannot substitute for the actual application receipt. |
| Drop the first changed row's update from native keyed reconciliation | `lazy version: mixed revision or public rollback`. The first row retains `task 0` while the remaining rows expose revision 2. Provenance alone would permit those individually delivered facts; coherence rejects their combination. |

Both shrink twice to seven rows, page size two, empty text and no supersession.
Both directly replay at seed `20261028`, path `0:0:0`, with exit 1 at the intended
comparison through each SDK. Restored production passes the same direct replay.
`calibration-v2` contains exact patches, commands, logs, before/mutant/restored
hashes and the final receiver hash. The final source was calibrated after the
review repairs. Earlier calibration logs remain preserved as stage-specific
evidence. The restored `options.ts` hash is
`ea2c2efc4d574080c5e03da8e121b79406640c667a1e260ead9eff22f6253d33`.

Normal final command, from `packages/convex-db-collection`:

```sh
CONVEX_TEST_BACKEND_VERSION=precompiled-2026-10-10-72ce13c \
  ../../node_modules/.bin/vitest run --config vitest.e2e.config.ts
```

Result: **21 tests pass across six files**, including both complete concurrency
campaigns. Targeted entry: `vitest.lazy.e2e.config.ts`; direct history replay adds
`CONVEX_BACKEND_CONCURRENCY_ORACLE_SEED=20261028` and
`CONVEX_BACKEND_CONCURRENCY_ORACLE_PATH=0:0:0` and selects
`e2e/lazy-concurrency-oracle.test.ts`. Correct production gives GREEN; the patches
in the evidence package are required to reproduce each hostile RED.

TypeScript, changed-file ESLint, oracle lint and `git diff --check` pass. Oracle
lint's known missing-local-`main` diagnostic accompanies successful use of
`origin/main` and exit 0. The runner resolves `@tanstack/db` to its local ESM
build. All 107 JavaScript modules are fingerprinted; all 106 embedded source-map
inputs match current source bytes. This binds the actual receiving runtime
without rebuilding it. The scientific models and seven Convex production files
retain their pre-round bytes.

## Review and preservation

An independent authority/design review and a fresh receiver review inspected
the sources and evidence. Review repaired a real reach gap: manual observations
could have satisfied the publication count without proving callbacks reached
the monitor. The callback-only exact snapshot witnesses now enforce that
boundary. The source review also required the explicit all-missing-facts-accepted
cut before abort. Final rechecks have no unresolved supported findings within
the stated profile; each report binds its final source hash.

A separate receiving-control calibration disconnects the actual change callback
while leaving manual observations intact and production correct. Both SDKs fail
`held revision never reached the publication callback`; the control shrinks and
directly replays at seed `20261028`, path `0:0:0`. The receiver is restored byte
for byte and the same replay passes. This is a test-recorder control, not a
production mutant or native provider failure. It confirms that the repaired
reach guard rejects the exact blind observation path identified in review.

The task's `outputs/convex-lazy-backend-concurrency-evidence` preserves raw logs,
patches, reviews, runtime fingerprints and source snapshots. Prior frozen
formal/audit/interleaving artifacts and versioned records remain unchanged.
The existing local install override is unchanged and uncommitted:
`baseline-browser-mapping` 2.11.32 → 2.11.30. No install, commit or push occurred.

## Limits

The backend monitor covers stable keys/ranks and complete acquisition before
version monitoring. It does not add general query translation, arbitrary
partial-prefix retention, row membership movement, idempotent/superseding receipt
attribution, accepted cleanup abandonment, native application/provider failures,
or same-run authoritative truncate replay. The composed failure/terminal-graph
monitor retains its controlled receiver, and existing backend/window/framework
owners retain their independent boundaries. Both SDK client classes are used;
this is not a new React rendering or hook-concurrency claim. The new backend
production mutation calibrates mixed revisions, while transient rollback/final-
correct recorder calibrations remain in the earlier version owner. Four fixed
and four random histories are bounded receiving evidence, not exhaustive
scheduling or a temporal proof. No new TLC run is claimed.
