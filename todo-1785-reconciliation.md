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
- [ ] Publish normal merge commit and refresh PR body against it.
- [ ] Final RFC adapter/docs audit; separately own remaining feature reports.

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

| Old area | Disposition |
| --- | --- |
| Core Collection construction and lifecycle (2 files) | Retain per-instance sync materialization and pre-start cleanup, preserving main's cleanup/reentrancy guards. |
| Persistence runtime and tests (2 files) | Retain generation and hydration fences; preserve newer object-identity acquisitions, failure handling, and one-shot refresh behavior. |
| Electric runtime, package, three test files and mutation ledger (6 files) | Retain lifecycle owner, sparse presence validation, reset reconciliation, and all tests; remove the replaced Store dependency. |
| Query runtime and two ownership test files (3 files) | Keep main: it already has the refcount guard, persisted ownership ordering, and stronger public ownership laws. Textual merge had duplicated a refcount guard; removed that duplicate. |
| Runtime identity code, test, and its changeset (3 files) | Already shipped. Keep main's lazy initialization plus symbol support and test; remove duplicate release note. |
| Facade adapter, builder, internal utils, architecture (4 files) | Keep main; do not restore metrics API or retained builder pointer. Add only a test-contract reference in docs. |
| Nested space fixture, test, benchmark, core package (4 files) | Retain tests and command entry points; count returned facade entries and retained maps through test-only instrumentation. |
| getKey planning and React/Solid tests (3 files) | Retain added behavior tests; no production changes to these boundaries. |
| AGENTS.md, lifecycle changeset, lockfile (3 files) | Keep independent-oracle rules; narrow release note to unshipped packages; retain Store dependency removal. |

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

| Entry | Main minified / gzip | Reconciled minified / gzip | Gzip delta |
| --- | --- | --- | --- |
| Core all exports | 347,757 / 98,632 | 348,349 / 98,793 | +161 bytes |
| Electric all exports | 96,396 / 31,749 | 95,220 / 31,022 | -727 bytes |

Runtime TypeScript delta: +410 lines (core +69, persistence +83, Electric +258).
No Query DB runtime changes or facade metrics remain in this PR.
