# Cursor implementation loss audit

2026-09-15. Base `3c54e89ae`, uncommitted cursor helper and tests.

The frozen candidate was the 143-line Query-owned `createCursorPager`, its
documentation and 87 passing tests. Two fresh, source-isolated agents scanned
the issue and historical plans separately. A third fresh agent was unavailable;
the implementing agent checked the oracle guide. That last pass is correlated,
not an independent sign-off. These are loss traces, not a completeness proof.

## Issue-only recovered material

Source: [issue #863](https://github.com/TanStack/db/issues/863), including the
three comments below. Exploratory proposals are not established requirements.

| Recovered item                                                                                                               | Where the frozen candidate lost it             | Disposition under the chosen scope                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic scope identity from collection/filter/order, excluding windows                                                     | Replaced by caller-supplied Query keys         | Explicit responsibility shift. Applications translate arbitrary endpoint parameters; the helper cannot derive that translation. Keys must describe source, tenant, filter and order. No automatic IR/session registry. |
| Existing subscription as the session owner                                                                                   | QueryClient/key ownership replaces it          | Explicit alternative not taken. Cached pages outlive an individual subscription and reuse Query's existing cache/GC rules. No additional subscription-owned state.                                                     |
| PK tie-breaking might remove the original cost difference; opaque cursors still have separate value                          | Compressed away with the metadata proposal     | Preserve as Sam's argument, not our measurement. The experiment's one-call saving appears only when N+1 crosses a physical page boundary. No general bandwidth/latency savings claim.                                  |
| Declarative `queryCollectionOptions` pagination config, initial numeric page parameter, next-page callback, simplified hooks | Reduced to a helper composed inside queryFn    | Explicitly not implemented. The helper starts at undefined and follows string tokens ending at null. Numeric page APIs keep the existing documented adapter pattern. No new hook configuration.                        |
| Enforce a PK tie-breaker and detect order changes                                                                            | Became a caller/backend precondition           | Explicitly not implemented. Endpoint order must be total; changed scope needs a different key. The helper cannot inspect an opaque endpoint's sorting.                                                                 |
| Generic facility for all collection types, outside the query engine                                                          | Narrowed to Query-backed pagination            | Keep the no-engine-change boundary. No cross-adapter metadata extension point in this PR.                                                                                                                              |
| Content-agnostic context, with interpretation callback either on the hook or collection                                      | Both alternatives collapsed into “no metadata” | Both remain excluded. This also excludes total counts, previous-page metadata, sync progress, stream/snapshot positions and Electric transaction IDs.                                                                  |
| Initial remote offset jump, then cursor continuation                                                                         | Local offset slicing can sound equivalent      | Explicitly excluded. Offset means traversing enough cursor pages and slicing; it is not a direct backend jump.                                                                                                         |
| Metadata-driven no-peek with fallback                                                                                        | Explicitly rejected earlier                    | Still excluded. The maintainer chose to close #863 with partial implementation: cursor loading ships; metadata/no-peek is intentionally not pursued.                                                                   |

Comment provenance: [Sam's identity/cost/architecture alternatives](https://github.com/TanStack/db/issues/863#issuecomment-3556836514),
[Kevin's two context API placements](https://github.com/TanStack/db/issues/863#issuecomment-3557243731),
[Enyel's declarative pagination proposal](https://github.com/TanStack/db/issues/863#issuecomment-3559079761).

## Plan-only recovered material

Sources: [contract and plan](./README.md), [no-peek results](./NO-PEEK-RESULTS.md),
and the user's choices to ship one PR, retain caching, and reuse Query semantics.

| Recovered item                                                                           | Loss mechanism                                                      | Disposition                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable cached rows; no cross-read identity promise                                    | Summary omitted caller obligations                                  | Added to public guide. Read returns a sliced array, not detached row objects.                                                                                                                                             |
| Reset does not refresh collection rows                                                   | Two-cache boundary compressed                                       | Public guide explicitly distinguishes reset, outer refetch and shared-prefix invalidation. Integration now checks that outer refetch alone can reuse fresh pages before invalidation refreshes both.                      |
| Endpoint owns cursor validity/invalidation rules                                         | Responsibility became only a stable-source precondition             | Kept explicit in the public guide. No TTL claims to repair an inconsistent backend sequence.                                                                                                                              |
| Prefix transport counts exclude separate tie-group requests; virtual row fields excluded | Verification summary compressed scope                               | Preserve these limits in README and final receipts. Pager work laws cover all calls within their single scope.                                                                                                            |
| Historical cancellation fault receipts use the old reader-owned acquisition contract     | Temporal flattening                                                 | Keep receipts labeled historical. Current Query-owned law retains successful pages after a reader abort; QueryClient cancellation separately discards late acquisition results.                                           |
| Specific no-peek benefit and safety laws                                                 | Entire feature excluded                                             | Keep the experiment and result file: boundary-only request saving; retained-tail truth; publication/prefix association; sticky per-consumer fallback; fact-only notification. These are not newly owed shipping features. |
| Generic eligibility and metadata wiring were unproven                                    | Could be mistaken for completed features later removed              | Preserve their unproven status. No claim that static scoped tests establish mutable multi-source metadata correctness.                                                                                                    |
| Fresh-per-call refetching and oldest-page TTL                                            | Replaced by Query-native semantics                                  | Deliberate change. New helper instances share pages by QueryClient/key; successful page growth updates Query's freshness timestamp. No independent clock/TTL implementation.                                              |
| One PR                                                                                   | Could be confused with earlier “independent” adapter recommendation | Preserved: helper, tests and docs belong in one PR.                                                                                                                                                                       |

## Oracle-guide pass and recovered tests

Source: [Writing reliable oracle tests](../../../../docs/contributing/oracle-tests.md).
This pass shares the implementer's context; it is weaker than the two isolated
readings above. It compares promises and test evidence, not every possible state.

| Guide obligation                                               | Evidence or recovered gap                                                                                                               | Action / limit                                                                                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference substantially simpler than production                | Full filter/sort/slice relation; cache model adds only permitted source snapshot and deadline                                           | Retained. No copied Query observer/retry/cache model.                                                                                                                                                            |
| Real production path, fixture must not perform the tested work | Opaque backend only serves pages; actual helper follows tokens. Integration runs QueryClient → QueryCollection → graph → controller     | Retained. Numeric rank/id fixture rejects unsupported predicates; not a generic IR interpreter or native framework run.                                                                                          |
| Calibrate checker sensitivity, not merely green execution      | Existing capped/reversed/duplicate controls; new cache law lacked a faulty-cache control                                                | Added a deliberate `ensureInfiniteQueryData` substitution that ignores invalidation. The same window checker rejects stale rows; normal refresh passes. This is an assertion failure, not timeout/setup failure. |
| Control the claimed cancellation boundary                      | Reader abort/reset existed; QueryClient transport cancellation newly documented without a witness                                       | Added held transport cancellation, aborted-signal witness, rejected read, no late cache installation, and successful subsequent read.                                                                            |
| Distinguish outer request success from fresh backend data      | Guide explained prefix invalidation, but test only exercised that happy path                                                            | Extended all four mutable-refetch cells: outer refetch first reuses cached rows with zero extra prefix requests; shared-prefix invalidation then exposes changed backend rows.                                   |
| Preserve valid histories when replacing machinery              | Offset/backward/overlap/zero/unlimited, partition, ties, failures, reset, peers remain                                                  | No prior test file deleted. Abort/retry work expectations changed explicitly to Query ownership; exact rows/error/peer outcomes remain checked.                                                                  |
| Async observations and public scope                            | Held initial delivery; Query cache held/failed refresh; every ready static window publication; settled mutable-refetch rows/hasNextPage | Does not establish every intermediate mutable-refresh publication or all framework schedules. Those broader contracts stay with existing collection/publication owners.                                          |
| Replay, shrinking and executable registration                  | Stable property names and shared seed/path parser; fixed/random lanes; new files in package oracle script                               | Fixed-seed 100× and default runs executed. No claim that one seed schedules real network/OS work, or that every counterexample has a separate replay-process receipt.                                            |
| Domain boundaries and lifecycle work                           | Finite stable backend sequences, controlled faults; real expiry/invalidation/GC; cancellation and reset                                 | No snapshot guarantee for changing HTTP endpoints, persistent cursor cache guarantee, per-page eviction or generic ordering validation.                                                                          |

## Evidence after recovery

Before audit recovery: package 341 tests passed, types/lint/build passed;
100× seed 863 passed 87 tests and 60,000 generated histories. Recovery adds
two tests and strengthens four existing integration cells; final receipts are
recorded in README after rerunning the gates.

Browser ESM, esbuild minification, target ES2020, same checkout/settings:
`queryCollectionOptions` alone: 46,590 bytes / 14,985 gzip.
Adding `createCursorPager`: 50,667 bytes / 16,475 gzip (+4,077 / +1,490).
This is an opt-in diagnostic import comparison, not every application's bundle
or an all-core comparison. The helper adds no core/hook source changes.

## Subsequent prep-pr corrections

The earlier cancellation witness covered only an initial request, where Query
has no cached result to restore. Review found that growth/refresh cancellation
could return the old cache as success and trigger another transport. It also
found that inherited `maxPages` evicted the prefix addressed by offset reads and
inherited `select` changed the observer's page format. The earlier cache model
was small enough; its configuration and scheduling domains were too narrow.

The expanded oracle crosses global/key defaults with selection/page eviction
and generated growth, backward windows and invalidation. Cancellation now crosses
initial/growth/refresh, page size/depth, shared waiters, late response delivery
and subsequent recovery. The real peer fetch join is observed before cancellation;
a shallow cache hit is checked while a deeper peer remains held.

Before the production fixes, eight of the expanded suite's 17 cells failed;
afterward all pass. Seed 863 minimized failing size/depth inputs to `[1, 1]`.
The fixes disable incompatible internal-page defaults and preserve Query's raw
acquisition rejection without blocking fresh cache hits. No reference-model
branch was added to imitate Query internals. Final full-package/stress/build
receipts and updated size measurements are in README; the measurements above
describe the earlier audit candidate, not the final helper.

The audit can itself turn old suggestions into obligations or over-rescue
interesting detail. The tables separate source observations from the later
scope dispositions. They do not infer consensus among issue commenters or
certify that the implementation has no undiscovered bugs.

## Cache publication review

The next external review exposed two further false-green boundaries. The cache
history awaited every read, so it never invalidated during growth. The repeated
cursor test observed rejection, but not whether invalid data had already been
published or whether a later read could recover.

The publication oracle keeps the same full-relation reference. It adds:

- Immutable cursor sequences with held suffix delivery, a real active outer
  QueryObserver, and the documented cancel-then-invalidate procedure. Omitting
  cancellation is a fault control rejected by the same row checker.
- Growth and refresh with a malformed final continuation, generated page sizes,
  depths and backward token targets, shared waiters, and Query retry enabled or
  disabled. Assertions cover rejection, no successful cache publication, retained
  last-good data, repair, and a subsequent fresh cache hit.
- Generated cached windows checked against full filter/sort/slice truth, with
  row-access counts requiring work proportional to the returned slice rather
  than all cached rows.

Before fixes, all four initial cells failed with seed 863. Growth/refresh
protocol failures shrank to size/depth/target `[1, 1, 0]`, where an invalid
acquisition emitted a successful cache publication. The slice failure shrank
to `[1, 1, undefined]`: a beyond-end empty read still accessed the cached row.
The held-growth failure returned version 0 after a required version-1 refresh.

Refresh is a documented procedure correction, not a new invalidation engine.
The driver now cancels before invalidating; the old procedure remains a negative
control. Protocol validation moved into response acquisition, before Query can
publish or resolve shared waiters. Its weakly held token set lasts only as long
as the acquisition signal; cached page parameters seed later growth. Slice
collection adds no persistent state. No production reference model, core query
change, metadata API or no-peek feature was added.
