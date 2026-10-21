# Stale reacquired Query ownership oracle review

Reviewed source: branch `investigate-finite-stale-reacquisition`, based on
`origin/main` at `31dad2dd3`. The first runs used `acaaf4c0a`. The counts,
RED/GREEN table, and mutant table were last rerun on the commit that follows
`67987ce10`, which extends the reacquired lease table and records the open
cells; that tree was measured before it was committed. The independent
reviews read the `acaaf4c0a` tree.

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
on-demand direct-write skip use the helper. The result-application rollback
snapshot keeps the entry by reference (CR-1 below). The production diff is 15
lines added and 6 removed in `src/query.ts`.

## RED and GREEN

| Witness | `main` `31dad2dd3` | Repair |
| --- | --- | --- |
| Reacquired lease table (42 cells: 7 refetch histories × 0–2 peers × 1–2 rows) | 20 fail. Example: `published: []` and `settled: []` where the model gives `["shared"]`. With peers, `shared` is lost only at `peerReleased`, while a two-row result loses `solo` at publication | 42 pass |
| Published owners table (8 cells) | 8 pass | 8 pass |
| Reacquired cache patch behind `deferDataRefresh` | Fails: cache `["Shared"]`, model `["Manual"]` | Passes |
| Empty-result direct insert (eager, on-demand) | 2 pass | 2 pass |
| Failed release commit (3 cells) | 3 pass | 3 pass |
| Reacquired commit fails after a held release | Passes | Passes |

The oracle file passes 585 of 585 tests with the repair and 564 on `main`. The
Query Collection package passes 1460 tests with 2 skipped, and the type check reports no errors.
Three repeated runs of the new tables gave identical results.

## Mutant results

Each mutant was applied to the repaired source, run against the whole oracle
file, and reverted. Counts are for the final oracle file.

| Mutant | Outcome | Killing witness |
| --- | --- | --- |
| Guard reads entry presence (the defect) | Assertion failure, 20 tests | Reacquired lease table |
| Release entry not marked | Assertion failure, 21 tests | Reacquired lease table, cache patch |
| Direct-write skip reads entry presence | Assertion failure, 1 test | Cache patch (Query cache only; public rows agree) |
| Applied means non-empty entry | Assertion failure, 2 tests | Empty-result direct insert: on-demand loses the insert at its receipt; eager keeps Manual after Newer |
| Delete entry at release | Assertion failure, 4 tests | Published owners `while-held`: owner count 2 instead of 1; without a peer the hydrated row leaks |
| Delete the released entry when the Query is reacquired | Assertion failure, 2 tests | Published owners `while-held, reacquired`: the reacquired lease has no cached result and its fetch fails, so `b` copies `a` back from unpublished metadata |
| Replace the released entry with an unmarked empty Set at reacquisition | Assertion failure, 21 tests | Reacquired lease table, cache patch |
| Mark the reacquired lease's own application entry as released | Assertion failure, 5 tests | Persisted direct-write refetch-start histories and the direct cache patch bound |
| Reuse the released Set object for the next application | Assertion failure, 25 tests | Reacquisition history and reacquired lease table: the reused entry keeps its mark |
| Guard removed (`false &&`) | Assertion failure, 4 tests | Persisted direct-write refetch-start histories |
| Hostile storage that swallows a failed commit | Assertion failure, 2 cells and 1 test | Both failed-commit witnesses |
| Cleanup skips entries without an observer | Survives the oracle file; assertion failure, 1 test, in the package suite | `tests/query.test.ts` "should clear retained ownership during explicit collection cleanup": a retained Query's retention marker survives cleanup |

The last four rows came from a later independent review. It reported two
survivors without a distinguishing history; the concrete versions above were
written from its descriptions. Deleting the released entry at reacquisition
survived every test until the `reacquired` published-owner histories were
added; it fails them and passes nothing else differently.

## CodeRabbit review of `8ff1db49f`

Review 5600814169 had one inline finding and a summary. Ledger:

| ID | Claim | Verdict | Action |
| --- | --- | --- | --- |
| CR-1 | The rollback snapshot in result application clones the entry, so a failed application that restores it drops a release's mark | True at the code level. No public consequence reached: in persisted histories the release retires its entry before the reacquired application snapshots (instrumented with the release commit gated and ungated), and in non-persisted histories the held commit rejects only by cancellation, which the restore guards skip | Fixed: the snapshot keeps the entry by reference, because application replaces the entry rather than mutating it. No witness distinguishes this; reverting it passes all 557 tests |
| CR-2 | Add a history with reacquisition during a held release, a commit failure before publication, and a failed refetch; the row must remain until the reacquired lease is released | The history runs; its expected result conflicts with the fail-loud law. The release is durable and the reacquired result is not, so the row leaves and the Collection enters `error` | Added "fails loudly when a reacquired lease's commit fails after a held release"; a storage adapter that swallows the failure fails it |
| CR-3 | Docstring coverage 0% for touched functions | True; the touched closure helpers use line comments like their neighbours | No change, per AGENTS.md's rule to match surrounding comment density |
| CR-4 | CodeRabbit's ESLint tool timed out | A tool note, not a code claim; the repository Lint check passed on `8ff1db49f` | No change |
| CR-5 | Title, description, and issue checks passed | Informational | No change |

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
- ORC-014: The controlled storage adapter supplies the commit failure. A
  receiving probe on the managed Node SQLite path aborted the release's delete
  with a SQLite trigger. The Collection entered `error` and storage kept the
  row, but the public Collection dropped it, while a peer's row stayed. The
  controlled, non-managed path keeps the row public. The controlled premise
  does not hold on the managed host, so the cross-boundary claim is
  contradicted, not established. The divergence belongs to the SQLite
  persistence owner; see Open cells.

## Bug-class boundary

Contract: Query ownership after release and reacquisition. Histories: an
on-demand lease with a one- or two-row result and a held release, a stale or
fresh reacquisition, zero to two peers, an optional refresh barrier, a direct write, and a failed release commit.
Path: Query Collection over a real QueryClient and a controlled persistence
adapter. Observations: public rows, stored rows, owners, status, and Query
cache at the named checkpoints.

Open cells:

- CR-1, unreached. Core rejects a committed, held sync transaction only in
  `state.cleanup()`, which runs after sync cleanup has removed the observers,
  so the restore guard returns. The remaining route is a duplicate-key replay
  inside the reacquired application's own open transaction, which no
  history here constructs.
- Managed SQLite durability failure. On the managed Node SQLite path, a
  release whose durable step fails still removes the row from the public
  Collection, while storage keeps it. This contradicts the glossary's
  accepted-sync-transaction rule, which accepts a wrapping sync's
  transaction only after its durable step. It belongs to the SQLite
  persistence owner and is outside this Query DB change.
