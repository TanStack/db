# Targeted intake: #2344 and #2347

Captured November 3, 2026 with complete bodies and all conversation comments (zero each). The cumulative ledger grows from 161 to 163 captures: 139 issues and 24 PRs, across the same 26 clusters. This targeted intake does not refresh the November 2 census of 144 open items.

| Issue | Primary classification | Session | Work kind |
| --- | --- | --- | --- |
| [#2344](https://github.com/TanStack/db/issues/2344) | Persistence / deleted payload retention and storage growth (standalone) | B30 | reported retention concern and separate capability questions |
| [#2347](https://github.com/TanStack/db/issues/2347) | Oracle campaigns / declared reach and seed replay (existing cluster) | B20 | oracle reach sampling gap |

## #2344: Persistence / deleted payload retention and storage growth

A local-only persisted Collection reportedly becomes logically empty after delete while the complete deleted value remains in SQLite tombstones indefinitely and in applied_tx.replay_json until bounded pruning. The report supplies a Node better-sqlite3 reproduction and connects retention to shared-device sign-out and storage growth. Establish the accepted logical deletion, tombstone, replay and retention promises before declaring a violation. Logical Collection deletion alone does not establish physical or secure SQLite erasure. Key/version-only tombstones, safe pruning, local truncate/purge and table removal are reported alternatives, not approved new capabilities.

Retained deleted payloads and retention policy require their own judgment. Sharing the persistence package with peer recovery is not evidence of a common cause; keep this standalone and coordinate P3/P6/P8 only where catch-up or durable machinery overlaps.

Coordination: P3/P6/P8: persistence and catch-up coordination only.

[Source](https://github.com/TanStack/db/issues/2344): “In a persisted collection with no sync (`persistedCollectionOptions` without `sync`, writes through `utils.acceptMutations`), deleting a row writes the row's **whole value** to the collection's tombstone table (`t_<hash>`).”

## #2347: Oracle campaigns / declared reach and seed replay

The Electric SDK snapshot-delivery campaign reportedly misses live-outage-crossed-by-throw at seed -387674631 after 40 histories. The guard fails at snapshotReach.assertReached(); no row or health refinement assertion failed. The independent input-grammar replay records six histories with at least five live attempts and zero fifth-attempt throws. Seed-only campaign replay is required: a shrink path intentionally disables aggregate reach checks. Preserve all reach requirements, actual fifth SDK attempt observations, fixed/random shared judgment, 40 generated histories and wrong-health/outage calibration. No production defect is demonstrated by this report.

Shares declared-state sampling and seed-replay reliability with #2287/#2289/#2329 and PR #2290. Its direct Collection/ShapeStream SDK path is distinct from the observer path; CI on PR #2346 does not establish that PR as the cause.

Coordination: PR:2346: CI context only; direct SDK path does not instantiate shared observer.

[Source](https://github.com/TanStack/db/issues/2347): “The reach guard is correctly rejecting missing coverage; the campaign needs a deterministic witness.”

## Evidence and limits

#2347 records property `electric.sdk-snapshot-delivery` in `packages/electric-db-collection/tests/electric-sdk-delivery-oracle.property.test.ts`. The reported CI job is https://github.com/TanStack/db/actions/runs/41653618677/job/125977987086 on PR #2346 head `e02e09c70ada77d5bbc52b51ebcdd4ee801fe028`, merge `0d7e08d22b6d3d29a53e621ea0bd4bdcab458285`, main `1443dc92e5417394acbdc98b782caa9802848ce6`. These are reporter records, not a locally executed replay. The extraction enum lacks a coverage-gap value, so `artifactType: unclear` is paired with canonical `productClassification: oracle-coverage-gap`.

#2344 reports versions 1.0.0-rc.1.2 for DB and the named SQLite persistence packages, using `persistedCollectionOptions` without `sync` and writes via `utils.acceptMutations`. Its Node reproduction uses better-sqlite3 `:memory:`. The body describes indefinite tombstone retention separately from the default 1000-row / 24-hour applied transaction pruning window. Node, browser OPFS and Expo behavior remain separate receiving claims. No secure erasure or new API promise is inferred.

[Assignments](supplement-2344-2347/assignments.json), [capture receipt](supplement-2344-2347/intake.json), [raw capture](supplement-2344-2347/capture.json), [extraction ledger](supplement-2344-2347/batch-001-ledger.md), [attributes](supplement-2344-2347/batch-001-attributes.jsonl) and [quotes](supplement-2344-2347/batch-001-snippets.md) retain the evidence. This intake did not inspect linked production source or CI logs, reproduce either report, change tests/production, publish comments or close issues.
