# Stale reacquired Query ownership oracle review

Reviewed source: `acaaf4c0a` on branch
`investigate-finite-stale-reacquisition`, based on `origin/main` at
`31dad2dd3`. Every run in this record used that tree before it was
committed; the commit hook made no changes. The independent reviews read
the same uncommitted tree.

## Contract and defect

PR #2198 (`db0ac815e`) made a released Query keep an empty `queryToRows` entry
until its release publishes, so metadata that has not published the release
cannot restore it as an owner. The result handler's already-applied guard and
the on-demand direct-write skip also read entry presence as "the active
observer lease has applied a result". When a stale Query was reacquired while
its release was held, the refetch-start notification repeated the cached
result, the guard read the release's entry as applied, and the reacquired
lease owned nothing. The release then removed the row, and a failed refetch
never restored it.

Laws checked, each stated beside its model in
`packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts`:

1. A reacquired observer lease owns the Query's latest successful data from
   reacquisition until its own release. A successful refetch replaces that
   result; a failed one keeps it. `staleTime` decides only whether a refetch
   starts.
2. Published owners never name a released lease, including when another lease
   claims the row while the release is held.
3. An accepted on-demand direct write patches the cache of an active Query
   whose lease has not applied a result.
4. An accepted direct write survives a refetch start of an empty current
   result.
5. A release whose durable commit fails is terminal for its sync run, and a
   restart begins from clean ownership.

Authority: the file's opening ownership and direct-write laws, the existing
reacquisition history, TanStack Query's stale-mount and failed-refetch rules,
the DbClient hydration history, the glossary's cleanup definition, and the
AGENTS.md fail-fast rules.

## Repair

`hasAppliedOwnership` reports an entry only when it is not a release's entry.
`removeQueryOwnership` marks its empty entry in a `WeakSet`. The guard and the
on-demand direct-write skip use the helper. The production diff is 13 lines
added and 3 removed in `src/query.ts`.

## RED and GREEN

| Witness | `main` `31dad2dd3` | Repair |
| --- | --- | --- |
| Reacquired lease table (14 cells) | 6 fail. Example: `published: []` and `settled: []` where the model gives `["shared"]`; peer cells fail only at `peerReleased: []` | 14 pass |
| Published owners table (8 cells) | 8 pass | 8 pass |
| Reacquired cache patch behind `deferDataRefresh` | Fails: cache `["Shared"]`, model `["Manual"]` | Passes |
| Empty-result direct insert (eager, on-demand) | 2 pass | 2 pass |
| Failed release commit (3 cells) | 3 pass | 3 pass |

The oracle file passes 555 of 555 tests with the repair. The Query Collection
package passes 1430 tests with 2 skipped, and the type check reports no errors.
Three repeated runs of the new tables gave identical results.

## Mutant results

Each mutant was applied to the repaired source, run against the whole oracle
file, and reverted.

| Mutant | Outcome | Killing witness |
| --- | --- | --- |
| Guard reads entry presence (the defect) | Assertion failure, 6 tests | Reacquired lease table |
| Release entry not marked | Assertion failure, 7 tests | Reacquired lease table, cache patch |
| Direct-write skip reads entry presence | Assertion failure, 1 test | Cache patch (Query cache only; public rows agree) |
| Applied means non-empty entry | Assertion failure, 2 tests | Empty-result direct insert: on-demand loses the insert at its receipt; eager keeps Manual after Newer |
| Delete entry at release | Assertion failure, 4 tests | Published owners `while-held`: owner count 2 instead of 1; without a peer the hydrated row leaks |
| Delete the released entry when the Query is reacquired | Assertion failure, 2 tests | Published owners `while-held, reacquired`: the reacquired lease has no cached result and its fetch fails, so `b` copies `a` back from unpublished metadata |
| Replace the released entry with an unmarked empty Set at reacquisition | Assertion failure, 7 tests | Reacquired lease table, cache patch |
| Mark the reacquired lease's own application entry as released | Assertion failure, 5 tests | Persisted direct-write refetch-start histories and the direct cache patch bound |
| Reuse the released Set object for the next application | Assertion failure, 9 tests | Reacquisition history and reacquired lease table: the reused entry keeps its mark |
| Guard removed (`false &&`) | Assertion failure, 4 tests | Persisted direct-write refetch-start histories |
| Hostile storage that swallows a failed commit | Assertion failure, 2 cells | Failed release commit |
| Cleanup skips entries without an observer | Survived | None. The restarted run fetches before any cached replay, so no reached history carries an old entry into a later read. Equivalent only on reached histories; unresolved for histories that replay a cache entry that outlives cleanup. |

The last four rows came from a later independent review. It reported two
survivors without a distinguishing history; the concrete versions above were
written from its descriptions. Deleting the released entry at reacquisition
survived every test until the `reacquired` published-owner histories were
added; it fails them and passes nothing else differently.

## ORC outcomes

- ORC-001: Each table states its law, authority, and limits before mechanics.
- ORC-002: The models keep lease results and owner sets. They do not import
  `queryToRows`, the guard, or sync transactions.
- ORC-003: Prose beside each model, grammar, driver, and comparison. The
  prose was updated with each grammar change.
- ORC-004: Fixed enumerations, not generated properties. Each axis has a
  stated contribution: `staleTime` starts the refetch; outcome and placement
  separate keeping, replacing, and losing the row; `peer` hides a lost result
  until `peerReleased`; `claims` reaches the unpublished-metadata premise.
  Excluded: eager reacquisition, whose premise is unreachable (probed:
  cleanup removes the Query from the cache, so a restart fetches); persisted
  retention, which keeps released rows by design.
- ORC-005: Public `loadSubset`, `unloadSubset`, direct writes, `DbClient`
  dehydrate and hydrate, `cleanup`, and `preload`. Observations are public rows,
  stored rows, Collection status, rejection messages, dehydrated owner counts,
  and `QueryClient.getQueriesData`. No missing-information hypothesis was
  identified.
- ORC-006: The mutant table above. Every kill is an assertion failure at the
  named comparison.
- ORC-007: Not applicable; no generated property.
- ORC-008: The reacquisition model keeps one result per active lease; the peer
  axis needs the union, shown by the peer cells that differ only at
  `peerReleased`. The owner model keeps a set; the owner count distinguishes
  `peer` histories that public rows do not.
- ORC-009: Glossary terms observer lease, acquisition release, publication,
  accepted sync transaction, and cleanup. `a`, `b`, `c`, and blocker are
  declared local names.
- ORC-010: Each history registers cleanup that releases its holds and Query
  clients; comparisons are single structured assertions.
- ORC-011: Not applied. The named shared-fault risk (an entry read as applied)
  is separated by the empty-result and cache-patch witnesses, which observe
  different boundaries; no further formulation was identified.
- ORC-012: This record.
- ORC-013: The reusable law "an empty entry is applied unless it belongs to a
  release" has a premise witness (reacquired lease table) and a nearby
  boundary witness (empty-result direct insert) that rejects the non-empty
  rule.
- ORC-014: The controlled storage adapter supplies the commit failure. No real
  SQLite failure witness exists; the cross-boundary claim is unresolved and
  belongs to the SQLite persistence owner.

## Bug-class boundary

Contract: Query ownership after release and reacquisition. Histories: one
on-demand row with a held release, a stale or fresh reacquisition, an optional
peer, an optional refresh barrier, a direct write, and a failed release commit.
Path: Query Collection over a real QueryClient and a controlled persistence
adapter. Observations: public rows, stored rows, owners, status, and Query
cache at the named checkpoints.

Open in-scope cells: a cache entry that outlives sync cleanup (the surviving
mutant), real SQLite commit failure, more than one row per lease, and more
than one peer.
