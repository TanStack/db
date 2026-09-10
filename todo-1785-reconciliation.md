# Reconcile lifecycle/resume work onto current main

Base: origin/main ad043b745. Published PR #1785 head: 97e5c642a.
Main includes merged #1797 and #1800; #1800's final head passed every CI check.
Use a normal merge, never rewrite published history or restore an old tree.

## Acceptance queue

- [x] Update RFC #1657: #1800 merged and verified.
- [x] Compare the old PR with main before porting.
- [x] Resolve the merge while preserving main's newer contracts.
- [x] Inventory every old test/fix: retained, already shipped, or retired with reason.
- [x] Run retained Electric/persistence lifecycle tests against main for RED evidence.
- [x] Verify per-collection Electric evidence/utilities, lazy startup and GC cleanup.
- [x] Verify resume presence, callback partitioning, move-out, and reset conflicts.
- [x] Verify persistence startup/hydration/invalidation generation fences.
- [x] Preserve useful space tests without adding production diagnostic APIs.
- [x] Rebuilt-core Electric, persistence, Query DB, framework and core gates.
- [x] Review resulting diff and size; narrow changeset to unshipped packages.
- [x] Publish normal merge commit and refresh PR body against it (368a1f24c).
- [x] Audit RFC contracts/docs and retain explicit owners for unresolved reports.
- [ ] CI and service-backed adapter E2E on the published reconciliation; RFC closure remains blocked.

## Reconciliation decisions

- Main already contains lazy runtime-reference identity and its regression.
  Keep main's symbol support and implementation; do not reapply the old variant.
- Main's ownership oracle replaces removed internal-map test seams with public
  behavior checks, including eager cache removal, exact acquisition release,
  and overlapping persisted owners. Keep these stronger tests.
- Do not restore BucketFacadeMetrics or a retained builder pointer for tests.
  Preserve the old nested-space law using test instrumentation.
- Persistence conflicts must preserve #1800's object-identity acquisitions,
  upstream rejection/peer ownership contract, and one-shot refresh behavior.
- Core cleanup must preserve main's reentrant-cleanup guard and status revisions.

## File and contract reconciliation

All 30 paths in the old merge-base diff are accounted for:

| Old area                                                                  | Disposition                                                                                                                                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core Collection construction and lifecycle (2 files)                      | Retain per-instance sync materialization and pre-start cleanup, preserving main's cleanup/reentrancy guards.                                                                           |
| Persistence runtime and tests (2 files)                                   | Retain generation and hydration fences; preserve newer object-identity acquisitions, failure handling, and one-shot refresh behavior.                                                  |
| Electric runtime, package, three test files and mutation ledger (6 files) | Retain lifecycle owner, sparse presence validation, reset reconciliation, and all tests; remove the replaced Store dependency.                                                         |
| Query runtime and two ownership test files (3 files)                      | Keep main: it already has the refcount guard, persisted ownership ordering, and stronger public ownership laws. Textual merge had duplicated a refcount guard; removed that duplicate. |
| Runtime identity code, test, and its changeset (3 files)                  | Already shipped. Keep main's lazy initialization plus symbol support and test; remove duplicate release note.                                                                          |
| Facade adapter, builder, internal utils, architecture (4 files)           | Keep main; do not restore metrics API or retained builder pointer. Add only a test-contract reference in docs.                                                                         |
| Nested space fixture, test, benchmark, core package (4 files)             | Retain tests and command entry points; count returned facade entries and retained maps through test-only instrumentation.                                                              |
| getKey planning and React/Solid tests (3 files)                           | Retain added behavior tests; no production changes to these boundaries.                                                                                                                |
| AGENTS.md, lifecycle changeset, lockfile (3 files)                        | Keep independent-oracle rules; narrow release note to unshipped packages; retain Store dependency removal.                                                                             |

## RED/GREEN evidence

Temporarily replaced the five changed runtime files with exact origin/main
versions and rebuilt db-ivm/core, leaving retained tests in place. Restored the
reconciled runtime afterward and rebuilt core again.

- Electric baseline: 41 failures / 15 passes, 56 cases, plus one unhandled
  cleanup rejection. This is a case count, not a distinct-bug count.
  Log: /private/tmp/1785-electric-main-red.log.
- Persistence baseline: two stale lifecycle tests RED, late-write guard already
  GREEN, and the resume-baseline test cannot run because main lacks its hook.
  The hook failure alone is not a reproduced bug. Electric's public persisted
  resume/hydration cases supply behavioral evidence.
  Log: /private/tmp/1785-persistence-main-red.log.
- Reconciled Electric: all 56 oracle cases GREEN; full package 15 test/type files
  pass with no type errors. Log: /private/tmp/1785-electric-full.log.
- Reconciled persistence: 148 runtime/type checks GREEN, six files.
  Log: /private/tmp/1785-persistence-full.log.
- Nested space: passes on current main without any production metrics API.
  Log: /private/tmp/1785-space-test.log.

Two old Electric GC/startup probes awaited successful preload after cleanup.
Updated them to observe rejection immediately and assert AbortError, matching
main's documented cleanup contract. The waiter retirement assertions remain.
No skips, weakened classifiers, or timeout increases.

The worktree's old pnpm installation tried to purge dependencies after the
package-manager version changed. Used existing local vite/vitest/tsc binaries
instead; no lockfile regeneration. For the main-only RED run, restored the
already-installed Store 0.9.2 dependency link required by main's Electric code.

## Reconciled-main verification checkpoint

- Core: 4,863 runtime tests / 150 files, all pass. Standalone tsc passes.
- Electric: 56 oracle cases pass; full package 15 runtime/type files pass,
  622 reported checks with no errors (type/runtime totals overlap).
- Persistence: 148 runtime/type checks, all pass.
- Query DB: 368 reported passes / 369 discovered checks, no failures or type
  errors; same count shape as the #1800 verification.
- React useLiveQuery: 57 tests pass. Solid useLiveQuery: 40 tests pass.
- Focused ESLint: zero errors, six existing require-await warnings.
- Logs: /private/tmp/1785-{core-full,core-types,electric-full,persistence-full,
  query-full,react,solid,lint}.log.

The current production delta is limited to core Collection lifecycle setup,
Electric, and persistence. Query DB runtime matches main exactly. Remaining:
final diff/size review, refreshed PR description, and the RFC-wide docs audit.

## Final size check

Compared exact origin/main ad043b745 runtime with the reconciled runtime using
esbuild 0.27.7, bundle + minify, browser, ESM, ES2022, identical installed
dependencies, and source aliases for core and db-ivm. Baseline source for each
changed runtime file was supplied from git show, without editing the worktree.
These are diagnostic entry bundles, not application download-size estimates.

| Entry                | Main minified / gzip | Reconciled minified / gzip | Gzip delta |
| -------------------- | -------------------- | -------------------------- | ---------- |
| Core all exports     | 347,757 / 98,632     | 348,349 / 98,793           | +161 bytes |
| Electric all exports | 96,396 / 31,749      | 95,220 / 31,022            | -727 bytes |

Runtime TypeScript delta: +410 lines (core +69, persistence +83, Electric +258).
No Query DB runtime changes or facade metrics remain in this PR.

## RFC contract/docs audit

- Applied settlement and request-scoped cancellation: core LoadSubsetFn and
  SyncConfig contracts plus transaction/refinement oracles; add the missing
  plain-language explanation to the adapter guide.
- Exact acquisition release: core UnloadSubsetFn contract, current Query DB
  ownership oracle, persisted failed-peer isolation tests; guide now states
  synchronous failure cleanup and asynchronous failure release obligations.
- Private replay, stale rows and bounded repair: error-handling guide and
  replay/ordered lifecycle suites agree; do not reinterpret transport completion
  as proof of source exhaustion.
- Electric lifecycle/resume: all 56 oracle cases pass. Add docs distinguishing
  invalid eager/progressive resume (error plus reset for next sync), unverifiable
  persisted hydration (fresh snapshot), and ignored out-of-subset partial rows.
- PowerSync: full package gate passes, 131 checks / eight files, no type errors.
  Log: /private/tmp/1785-powersync-full.log.
- #1017 is OPEN and remains pinned as an exact expected assertion failure in
  load-subset-oracle.property.test.ts: source rows are still hidden while a
  derived optimistic mutation persists. The full core run exercised that pin;
  passing the suite does not mean the desired behavior passes.
- #968 is OPEN. React still declares but does not invoke getNextPageParam;
  server-page bridging/source extent remain separate from this resume fix.
- #836/#1521/#1615/#1659/#1741 and the feature reports remain separately owned
  as listed in the RFC. No broad cross-adapter conformance or service-backed E2E
  claim follows from these local gates. RFC closure is not justified yet.

## External review fixes — 2026-09-10

Starting head: `885ed1c9165fbbebd5dfb278189d2452ff25574e`. Changes below are
local follow-ups to that head, not a new published verification claim.

- [x] Fresh eager recovery replaces the hydrated cache at commit. The integrated
      recovery oracle crosses eager/progressive, empty/nonempty replacement, and
      hydration before/after the stream callback. It asserts public and persisted
      rows. Four eager cases were RED before the fix; all ten cases, including two
      valid-resume controls, are GREEN.
- [x] Subset acquisition cannot resurrect logically removed row presence. The
      fix reads the existing pending sync queue and progressive buffer instead of
      maintaining another history. A nine-cell reset/delete/move-out × acquisition
      timing matrix and a generated acquisition-history oracle cover the path.
      Reintroducing unconditional baseline refresh makes the generated oracle RED;
      its shrunk trace is retained as a committed example alongside random runs.
- [x] Resumed invalid-update validation follows executed visibility changes.
      Removed the separate preflight planner, which omitted move-outs. Generated
      delete/move-out histories now cross eager/progressive and every contiguous
      callback partition, checking rows, error state and persisted reset together.
      Cancellation preserves the prior public snapshot and discards staged evidence.
- [x] Reusing raw or once-spread options does not rebind another collection's
      utilities. Only adapter-factory utilities are copied, preserving descriptors
      and prototype; ordinary utilities retain their existing object identity.
- [x] Tag visibility belongs to each Collection, not the reusable descriptor.
      A first per-session fix failed a compatible persisted-restart probe. The
      final Collection-keyed tracker retains that state across compatible resume
      and clears it on fresh snapshot/reset. All 20 descriptor/restart tests pass.
- [x] Corrected the mutation ledger's collection-local evidence attribution.
      Fresh-descriptor process generation does not prove shared-descriptor safety.
      Added all new suites to the package's `test:oracles` command and documented
      authoritative fresh replacement and descriptor reuse in the adapter guide.

Lessons: stream markers do not substitute for actual acquisition calls;
published presence can lag logical deletion; fresh transport startup does not
itself replace a durable snapshot. Partition laws must include tag events.
Ownership tests must cross both peer collections and compatible same-owner
restart, not assume every session should discard every state cell.

Scope: retaining in-memory tags for the same Collection does not add cold-start
restoration of tag indexes from persisted metadata. That pre-existing limitation
and different-schema reuse of a static shape were not established as new PR
bugs and are not claimed fixed by these tests. The review's original sandbox
artifacts were unavailable; all three reported traces were independently rebuilt
against the actual Collection/Electric/persistence path.

Verification: 4,865 core runtime tests (150 files) and 355 Electric runtime tests
(9 files) pass. Core and Electric standalone TypeScript checks and focused lint
pass. Final persistence rerun and loss-audit closeout are recorded below.
Logs: `/private/tmp/1785-review-fixes-{core,electric,persistence}-final.log`.
Detailed source-order evidence: `/private/tmp/evaluate-1785-external-fd82-ledger.md`.

Final persistence rerun: 75/75 tests pass (two files), bringing these runtime
gates to 5,295 passing tests. The final bounded peer review confirms all its
findings are accounted for: descriptor tests 20/20, collateral probes 3/3, and
original lifecycle probes 7/7 GREEN. External source-order loss audit: seven
items fixed, one deferred original-artifact retrieval only; no unresolved
behavioral evidence gap. Utilities/tag isolation and mutation attribution from
the prior review are also fixed. Net production change versus reviewed head:
nine added TypeScript lines; no compressed-size measurement claimed here.

## Second external review follow-up — 2026-09-10

Still local to reviewed head `885ed1c9165fbbebd5dfb278189d2452ff25574e`.

- [x] R1: partial updates use the applied baseline plus pending writes. Removed
      the retained `knownKeys` copy. Independent persistence publications now
      reach Electric without an intervening subset acquisition. All six
      eager/progressive/on-demand × targeted/full-reload cases were RED before
      the fix and are GREEN now. The generated history crosses peer insertion,
      deletion, reload, and subsequent partial updates, asserting public and
      durable rows after each transition. It waits on a coordinator publication
      marker even when the row set is unchanged; equality alone would false-green.
- [x] R6: new and deduplicated acquisitions both perform zero applied-key scans
      in deterministic 10/100-row work tests. Stream callbacks inspect the
      pending sync queue and progressive buffer once, then use keyed lookups.
      This avoids O(applied rows) copies, not all work on queued operations.
- [x] R3: warn once per options descriptor when an older persistence wrapper
      cannot attest hydration for a saved resume. Keep the safe fresh-fetch
      fallback and give explicit package-update guidance. Compatible cleanup/
      restart does not repeat the warning. No mandatory persistence dependency.
- [x] R7: remove the stale row-returning capability type. Hydration is a barrier,
      not a second persisted-row query; `scanPersisted` is a presence marker.
- [x] R4: retain the review's exact persisted-wrapper/real-insert path as a
      regression, in addition to raw/once-spread utility tests. An acknowledgement
      on A resolves A's insert after B starts; the prior shared-utils mutant
      rejected that insert despite A receiving its txid.
- [x] Keep R8's requested todo record. R2's unknown-partial-resume error remains
      intentional: main's apparent success materialized an incomplete row.

Test-integrity checks: removing the applied-baseline fallback makes the peer
publication property RED; ignoring the pending overlay makes parked delete and
move-out RED (reset remains a passing control because truncation drains at once).
The random differential property also exposed an oracle-domain bug: its partition
filter checked only the first reset, admitting reset/subset/reset in one callback.
Validate every reset and pin that history. Do not change production semantics or
increase timeouts to accommodate an illegal publication-epoch partition.

Limits retained from the source-order audit: cold-new-Collection tag restoration
is not added; different schemas for the same static shape and hand-copied wrappers
remain unproven paths, not refuted supported cases. Bounded match-buffer work and
live-session snapshot-evidence growth remain separate performance questions.
No service-backed or installed mixed-version conformance claim follows from the
mocked stream and capability-shape tests.

Electric: 368/368 runtime tests in nine files; persistence: 75/75 runtime tests
in two files. Electric tsc and focused lint pass. The 92-test descriptor/oracle
rerun passes after the final diagnostic wording/type adjustment. Detailed logs:
`/private/tmp/1785-second-{electric,persistence,types,lint}-final.log`,
`/private/tmp/1785-second-final-focused.log`, and the two
`/private/tmp/1785-no-{baseline,overlay}-mutant-final-red.log` files.
Updated mutation recipes live in `packages/electric-db-collection/tests/ORACLE_MUTATIONS.md`.
Full source-order ledger: `/private/tmp/evaluate-1785-second-2bf032-ledger.md`.
Combined production diff versus the reviewed head: three fewer TypeScript lines
(core +5, Electric -8); this is not a bundle-size measurement. No commit or push.

Final core rerun: 4,865/4,865 runtime tests, 150 files, at the same local runtime
(`/private/tmp/1785-second-core-final.log`). Total core/Electric/persistence:
5,308 passing runtime tests. No test was skipped to clear a failure.
