# Convex lazy paging: receipt ambiguity and partial-window boundaries

Starting head: `8c24922026fb4a714cb54b992ac85faa2e876742`.
This record supersedes the current-source bindings of the earlier receipt and
version records for the files in its [source manifest](2026-10-27-convex-lazy-boundaries-source.json).
Older records and frozen evidence are preserved. Changes remain local; no
commit, push or new TLC run is claimed.

## Law and scientific account

Authority is `LoadSubsetOptions.refetch/signal`, `LoadSubsetFn` and
`SyncAppliedReceipt` in `packages/db/src/types.ts`, the ordered-prefix contract,
and publication/cleanup laws 7, 9 and 14 in `query/live/ARCHITECTURE.md`.

Successful or canceled accepted work owes its actual establishing application
receipts even when its row values equal an already applied relation. A later
revision may already be visible when an earlier receipt observer runs: the
actual receipt proves application, not historical equality at that later cut.
A conforming unchanged revalidation may accept another receipt or need no new
receipt. The model does not prescribe either batching choice.

A partial source may retain delivered rows. Its entire retained base need not
match any complete server revision. The promised live ordered window must match
an independently authored scoped relation and advance monotonically through
compatible offered revisions. Old complete observations may stutter; revisions
may be skipped. Every applied base fact separately needs provider provenance.

Cleanup permits pending actual receipts to reject as abandoned. Abort and
ordinary provider error do not grant that authority. Calling cleanup alone does
not discharge a pending receipt; the driver must observe actual rejection.
Cleanup makes an old dependent graph terminal with its last complete value. A
fresh sync run may serve a fresh graph without reviving the old one.

The task-local `laws.md` records these predictions before model edits. In the old
receipt model, cleanup abandonment was unrepresentable. The extension retains
pending/applied/abandoned receipt state and cleanup authority. These distinguish
cancellation while work is pending, lawful cancellation after actual cleanup
abandonment, and success after application. Abandonment cannot provide applied
facts for success. This is an authority-based extension, not an expectation
changed to fit an observed implementation.

`LazyVersionModel` now distinguishes relation observations from ordered sequence
observations. `expectedLazyRows` independently projects authored relations into
the promised window before offering those sequences. `LazyTerminalGraphModel`
is the existing last-value/cleanup judgment moved into the shared model owner;
both controlled and backend receivers use it. No cursor, page chain, queue,
sealing state, SDK identity or transport phase enters these scientific models.

## Receiving paths and grammar

`tests/lazy-paging-revalidation-oracle.property.test.ts` uses the native public
paginated factory, real Collection/core receipts, coherent controlled SDK caches
and real optimistic holds. Each isolated explicit revalidation attributes only
commits actually made inside its synchronous invocation. Equal-valued fresh SDK
objects witness an accepted idempotent batch even though every fact already
applied. A newer accepted revision supersedes it while held. One caller aborts;
its peer and a cached revalidation must also obey their actual obligations.
An additional unheld reactive revision exercises the ordinary callback path.
Actual callback snapshots must witness the held-drain and reactive latest
relations; manual checkpoints cannot supply those witnesses.

The bounded grammar has 5–11 rows, page sizes 2–4, both order directions, short
text and either canceled caller. Every history runs both SDK shapes, even if one
fails. Its fixed/random campaigns each run 30 histories: 120 SDK episodes total.
Each of the eight declared states reaches 30 histories in each lane. With the
run multiplier at three, each lane reaches 90 histories, totaling 360 episodes.
The current implementation exhibits zero-new-receipt cached reuse in every
successful episode; this is measured separately, without requiring that choice.

`e2e/lazy-boundary-oracle.test.ts` supplies real SDKs, opaque server cursors,
atomic server edits, actual query errors, actual application/abandonment receipts
and a real dependent graph. The ledger authors expected relations before server
mutations; an independent unpaginated query verifies the final server fixture.
Only genuine SDK reads enter the separate provenance recorder.

Its grammar has 18–24 rows, page sizes 2–3, initial limits 2–3, a growth window
at offset one with limit 7–8, short text, either canceled caller, and two or three
accepted revisions during the growth hold. Each history:

1. Proves an unread tail and a partial acquired source.
2. Holds application while one atomic transaction deletes, inserts and moves an
   unread row into the promised window, then drains to its exact result.
3. Starts larger-window acquisition, proves its promise still waits on an actual
   held receipt, and accepts later membership/order revisions before release.
   The grown result must be exact while a separately witnessed tail stays unread.
4. Acquires full coverage for two callers, proves shared held establishment and
   no missing required facts, aborts one caller, then causes an actual reactive
   server query error via the test-only control document.
5. Requires the canceled caller to keep waiting until application or cleanup.
   Cleanup authorizes actual receipt abandonment; the old graph stays terminal
   while a fresh run and fresh graph recover.

Every original-graph change/status event and every base publication reaches its relevant
monitor. Subscriber exceptions are retained and surfaced at explicit checkpoints.
Polling stops on a retained semantic failure before it can become a misleading
timeout. Four matching fixed/random histories per lane give sixteen SDK/backend
episodes; each of ten declared states reaches four histories in each lane. The
deeper campaign has twelve histories per lane, giving forty-eight episodes.

Reconstruction: minimum-row/page/window cases are the captured shrinks below;
order reversal, caller choice and revision count reconstruct adjacent schedules.
Ablating fresh equal-valued acceptance loses content-independent receipt debt;
removing the unheld callback loses the transient-publication challenge; removing
held demand growth loses mutation-during-acquisition reach; removing query error
or cleanup loses their authority distinction. Larger source bounds retain a
truly unread suffix after growth. Nearby excluded histories include abandonment
under ordinary abort, source acceptance after cleanup in the ended model, and
success using an abandoned receipt. The executable model controls reject them.
The backend family excludes ties and edits during an unresolved prior edit;
other owners retain those independent profiles.

## Calibration and replay

All production sources remain unchanged from the start of this round. Correct
production passes the extended receivers; no product-defect RED or repair is
claimed. In isolated local Git clones overlaid with the current source, two
production decisions and one separate publication perturbation are challenged:

| Calibration | Intended comparison | Seed/path |
| --- | --- | --- |
| Clear pending visibility when an unchanged cached result arrives | `receipt law: equal settled before receipt-2 applied` | `20261029` / `0:0` |
| Iterate the new keys instead of the previous keys when emitting deletions | `lazy version: mixed revision or public rollback`; deleted rows contaminate the grown public window | `20261029` / `0:0:0:0:0:0` |
| Deliberately preserve and replay the previous native publication between new and corrected publications | Same version law; both SDKs report `finalMatchesLatest:true` while retaining the earlier violation | `20261029` / `0:0` |

All three fail semantically through both SDKs, shrink, directly replay with exit
one, and give GREEN after byte-for-byte restoration. The third is a native
publication perturbation, not a minimal production decision mutant or provider
failure. It exercises actual core writes/publication rather than injecting a
wrong answer into the scientific model. `calibration-final-v5` contains the final
patches, commands, hashes, source bindings, REDs, replays and restored GREENs.

An earlier candidate replayed the current result cache. It survived on the
exercised paths because explicit refetch and published-range callbacks invalidate
that cache before a changed relation publishes. No global equivalence is claimed.
The retained-publication perturbation supplies the distinguishing wrong output
without weakening that invariant. Intermediate calibration directories are not
final-source kill evidence. Port contention, a wrong command working directory,
and shared coverage output races are preserved as setup/harness failures, never
semantic rejections.

Comparator controls additionally reject abandonment without cleanup, canceled
settlement while a receipt is still pending, success using an abandoned receipt,
wrong window order and rollback after a newer observation. Positive controls
accept zero new receipts, additional actual receipts, coherent skipped revisions,
old complete stuttering and lawful retained base facts. Existing independently
varied response/commit partitions continue through the same receipt model.

Commands below run from `packages/convex-db-collection`:

```sh
pnpm test:oracles
CONVEX_TEST_BACKEND_VERSION=precompiled-2026-10-10-72ce13c pnpm test:e2e
CONVEX_LAZY_ORACLE_RUNS_MULTIPLIER=3 pnpm exec vitest run tests/lazy-paging-revalidation-oracle.property.test.ts
CONVEX_TEST_BACKEND_VERSION=precompiled-2026-10-10-72ce13c CONVEX_LAZY_ORACLE_RUNS_MULTIPLIER=3 pnpm exec vitest run --config vitest.lazy.e2e.config.ts e2e/lazy-boundary-oracle.test.ts
```

Direct replay selects the native file with `CONVEX_REVALIDATION_ORACLE_SEED=20261029`
and `CONVEX_REVALIDATION_ORACLE_PATH=0:0`, or the backend file with
`CONVEX_BOUNDARY_ORACLE_SEED=20261029` and
`CONVEX_BOUNDARY_ORACLE_PATH=0:0:0:0:0:0`. Correct production is GREEN; apply the
matching saved perturbation/patch to reproduce RED. The scripts discover the
native family, and the existing browser CI job already runs the backend family
via `test:e2e`; no new scheduler or background automation is introduced. Run
backend commands serially because the local CLI checks its default port across
checkouts. Concurrent native runs need separate coverage directories.

The full package command passes 108 runner cases across eighteen files, including
four type assertions; the complete backend suite passes 22 cases across seven
files. These are runner counts, not counts of independent oracles. The new oracle
reach and receiving episode counts above are the semantic evidence. TypeScript,
changed-file ESLint, oracle lint and diff checks pass. The dedicated test tsconfig
fixes Vitest incremental source-root errors without disabling typechecking or
changing production build configuration.

## Oracle-review self-audit

This round uses the oracle-review skill for self-review; no fresh independent
review is claimed. The raw evidence and this record bind the reviewed source.

| Requirement | Outcome |
| --- | --- |
| ORC-001 | API/architecture authority and bounded receiving limits stated above. |
| ORC-002 | Scientific facts, receipt debt, cleanup authority and authored windows are independent of pager mechanics. |
| ORC-003 | Opening contract, shared models, grammar, real drivers and event comparisons are directly named in each executable owner. |
| ORC-004 | Bounds, reconstruction, ablations and excluded authority states accounted for above. |
| ORC-005 | Actual factory/core/SDK paths, held-growth promise, genuine query error, actual abandonment and callback witnesses are reached. |
| ORC-006 | Two decision mutants, one publication perturbation and separate model controls reject at intended comparisons. |
| ORC-007 | Matching fixed/random budgets and checked shrunk seed/path replays. |
| ORC-008 | Cleanup authority and three receipt states change legal abandonment/settlement; sequence versus relation equality changes allowed order. |
| ORC-009 | Shared glossary vocabulary; isolated-call attribution and projected application fields are driver abstractions, not pager states. |
| ORC-010 | Retained callback failures, original nested causes, both SDKs after a failure, and cleanup aggregation preserve the law failure. |
| ORC-011 | Row equality as a proposed substitute for receipt application is independently challenged with actual core receipts; scoped array recomputation and real server order challenge stale/deleted windows. No new second pager is used. |
| ORC-012 | This versioned record, source manifest and frozen evidence distinguish final calibration, intermediates and open cells. No broad bug-class closure is claimed. |
| ORC-013 | Equal already-applied facts versus a newly pending actual receipt, pending versus observed-abandoned cleanup, and partial versus whole-source judgments have distinguishing witnesses. |
| ORC-014 | Actual server supplies partial mutation, query-error and cleanup premises; equal-valued SDK emission remains explicitly fixture-scoped. |
| ORC-015 | Required eight native and ten backend reach states fail on underreach and are recorded per campaign. |

Self-review repaired two overconstraints before final validation: requiring
cached reuse to create zero receipts, and requiring a graph to stay `ready`
during ordinary provider failure. Neither is promised by the contract. It also
strengthened growth from a potentially cached window to an actually pending held
acquisition, and added unheld reactive receiving. None of these repairs weaken
receipt application, coherent publication or cleanup terminality.

## Limits and preservation

Native idempotent attribution is limited to isolated synchronous explicit
revalidation against coherent controlled SDK caches. It does not establish a
real backend must emit equal-valued query updates, general asynchronous receipt
attribution, or reentrant commit listener ordering. The backend family uses
ascending unique ranks and sequenced atomic edits, with mutation overlapping
held growth. Arbitrary nonquiescent schedules, error before acceptance, stale
real-SDK callback injection, authoritative truncate replay, rank-tie changes and
React hook/render concurrency retain their existing owners. The controlled
failure grammar remains broader than the backend receiving subset. No finite
campaign or deeper run is an exhaustive temporal proof.

Seven Convex production source files, the two existing install-workaround files,
and all prior frozen formal/audit/interleaving/backend evidence remain unchanged.
The pre-existing uncommitted local override remains
`baseline-browser-mapping` 2.11.32 → 2.11.30. No dependency install occurred.
Task-local raw evidence and source/runtime snapshots are frozen separately in
`outputs/convex-lazy-boundary-strengthening-evidence`.
