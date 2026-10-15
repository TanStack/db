# Optimistic ordered-window departure review (#2169 and #2148)

## Reviewed state

- Base: `origin/main` at `a09ba670b`.
- Primary owner:
  `packages/db/tests/query/ordered-work-oracle.property.test.ts`.
- Proposed contract source: the optimistic-overlay exception added to
  `packages/db/src/query/live/ARCHITECTURE.md` by this change.
- Adjacent owners: the pagination oracle's provider-coverage matrices and the
  optimistic-history oracle's snapshot and settlement model.

The eventual commit or pull request identifies the immutable reviewed tree.
This record fixes the base and the evidence obtained before commit.

## Law and bounded grammar

An optimistic membership departure from an ordered window is public at
admission. The window immediately recomputes over installed rows. Missing
provider extent starts acquisition before persistence settles. A provider page
whose applied receipt is queued behind that mutation remains private. After
settlement, acknowledgement shows the complete recomputed window and rollback
restores the original window.

#2169 reports `[3, 2] -> [2, 1]` while persistence is pending. Its maintainer
comment identifies the collision with #2131's complete-window barrier and
offers a shorter intermediate window as one candidate: publish the last
complete window minus the departed row, then fill the gap when the applied
receipt settles. This change selects that candidate for provider rows that are
not installed. It preserves transaction isolation and does not treat an
unapplied provider answer as public. When the replacement row is already
installed, the same recomputation is complete immediately. The architecture
edit is therefore a proposed contract revision whose acceptance belongs to this
change; it is not cited as pre-existing authority.

The finite grammar crosses three predicate shapes (source, joined, and
anti-joined), two departure operations (update and delete), two consumers
(Collection and Effect), two outcomes (acknowledgement and rollback), one- or
two-row windows, and indexed or unindexed source loading, for 96 cells. A
four-row reference relation puts a rejected root ahead of the visible rows.
The fixed public checkpoint table is independent of those production
classifications:

| Replacement extent | Width | Initial  | Optimistic and provider-pending | Acknowledged | Rolled back |
| ------------------ | ----- | -------- | ------------------------------- | ------------ | ----------- |
| Missing            | 1     | `[3]`    | `[]`                            | `[2]`        | `[3]`       |
| Missing            | 2     | `[3, 2]` | `[2]`                           | `[2, 1]`     | `[3, 2]`    |
| Installed          | 1     | `[3]`    | `[2]`                           | `[2]`        | `[3]`       |
| Installed          | 2     | `[3, 2]` | `[2, 1]`                        | `[2, 1]`     | `[3, 2]`    |

Width two reconstructs #2169's surviving-row trace. Joined and anti-joined
deletes also require the submitted provider page to contain the exact row that
can refill the window, so a request that starts without useful progress does
not satisfy the law.

The indexed cells exercise missing extent. Unindexed joined and anti-joined
cells install the full root extent and therefore exercise immediate local
refill; unindexed source predicates still need provider acquisition. The matrix
does not claim arbitrary optimistic histories, the exact historical #2148
provider replay, ties, offsets, rank moves, overlapping transactions, or real
query-db scheduling.

### Grammar controls

| Control      | Semantic contribution                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape        | Separates direct membership from joined and anti-joined eligibility; removing it loses #2148's relation-filter path.                                                                                                              |
| Mutation     | Update covers #2169's predicate departure; delete covers #2148's overlay removal.                                                                                                                                                 |
| Consumer     | Collection order/publication and Effect membership callbacks use different publication machinery.                                                                                                                                 |
| Outcome      | Acknowledgement requires the recomputed window; rollback requires restoration.                                                                                                                                                    |
| Width        | Width one exposes the empty-window boundary; width two exposes a surviving-row position and reconstructs #2169's reported starting shape. Larger widths repeat the surviving-prefix rule and are marginal in this four-row model. |
| Loading mode | Indexed pages leave replacement extent missing; the unindexed relation-filter path installs it and must refill locally.                                                                                                           |
| Exclusion    | Non-departing updates, rank moves, ties, offsets, and overlapping transactions are rejected from this grammar because they require different reference rules.                                                                     |

## Production path and observations

The controlled on-demand provider computes pages from its own ledger with the
reference expression evaluator and requested order. It records each acquisition
attempt. Eight deterministic task turns observe whether acquisition begins
while persistence remains held, before allowing the provider answer. This is
an instrument bound, not a product deadline. The answer uses the real sync
commit receipt, which remains
queued behind the mutation until settlement. This separates provider
availability from application rather than using one promise for both causes.

The driver uses normal `source.update` and `source.delete` mutation handlers,
real joined plans, and public live-query Collections or Effects. It observes
synchronous rows, Collection change publications or Effect callbacks, request
initiation, both pending cuts, submitted row identities, final rows, and a
request count across two post-settlement task turns. That observation is not a
general fixed-point proof. An eight-request ceiling is only an emergency
runaway guard.

## RED evidence and issue relationship

On the reviewed base, all source-predicate cells and all indexed delete cells
retain the initial window at admission. This includes #2169's direct
predicate-removing update class and indexed joined and anti-joined optimistic
deletes. Indexed joined and anti-joined updates do show the short synchronous
result and start refill acquisition. Effects publish that departure, while
Collections omit the public subscriber publication. Unindexed joined and
anti-joined cells recompute over their installed replacement rows and satisfy
the bounded law.

The controlled joined-delete histories start a request before settlement, but
the submitted page omits the exact row needed to refill the window. This is the
indexed missing-progress class behind #2148; a scalar request count alone would
have missed it. A hostile-observation control also supplies otherwise-correct
public snapshots while suppressing acquisition and submitted rows, and the
checker reports both violations. The mismatch ledger evaluates every obligation
before accepting only the reviewed base's exact symptoms. The repair replaces
that ledger with an empty ledger; it does not change the law or observations.

This evidence exercises the unindexed core path but does not reconstruct
#2148's exact historical provider replay. It also cannot exercise #2169's
query-db `invalidateLoadedSubsets()` repair trigger because that API is not in
the reviewed base. Those receiving histories remain open in their existing
owners.

## ORC-012 audit

| Requirement | Outcome                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001     | Proposed contract. The issue establishes immediate optimistic visibility; its comment offers the short-window exception as a candidate. This change makes that choice explicit for review rather than treating current behavior or the new architecture prose as prior authority. |
| ORC-002     | Pass. A fixed public checkpoint table predicts each window without production state or helpers.                                                                                                                                                                                   |
| ORC-003     | Pass. Law, grammar, reference table, provider, production driver, recorders, and comparisons are distinguishable.                                                                                                                                                                 |
| ORC-004     | Pass for the declared finite grammar. The controls above account for reconstruction, axis contribution, width range, and exclusions. The exact historical provider replay and query-db trigger remain outside the claim.                                                          |
| ORC-005     | Pass. Real Collections and Effects are observed through their public rows and publications.                                                                                                                                                                                       |
| ORC-006     | Pass for the exercised wrong designs. The reviewed base fails immediate visibility, Collection publication, and submitted-row progress. A hostile observation proves the checker rejects no acquisition and no useful submitted row; no production mutant was run.                |
| ORC-007     | Not applicable. This is an exhaustive finite matrix, not random generation.                                                                                                                                                                                                       |
| ORC-008     | Not applicable. No stateful model changed.                                                                                                                                                                                                                                        |
| ORC-009     | Pass. Separate gates identify acquisition start, provider answer submission, applied receipt, and settlement.                                                                                                                                                                     |
| ORC-010     | Pass. History cleanup releases all gates, settles receipts, disposes both consumer forms, and preserves primary failures.                                                                                                                                                         |
| ORC-011     | Pass as formulation parity, not implementation independence. Collection and Effect exercise separate publication paths.                                                                                                                                                           |
| ORC-013     | Partial. The fixture records useful submitted rows and stability across two task turns; it does not prove absence of a delayed retry. The eight-request ceiling is emergency-only.                                                                                                |
| ORC-014     | Pass, limited. The provider is controlled; real query-db behavior is not claimed.                                                                                                                                                                                                 |

## Verification

- Focused 96-cell characterization plus hostile control: all 97 tests pass, including the complete
  exact mismatch ledger.
- Complete ordered-work owner with `TANSTACK_DB_ORACLE_SEED=1`: 229 tests
  passed with no type errors.
- Three independent oracle-review attacks challenged law authority, model and
  checkpoint independence, and mutant-killing power. Their supported findings
  produced the loading-mode axis, order-preserving Collection recorder,
  attempt-specific pending evidence, complete publication-suffix comparison,
  hostile no-progress control, grammar audit, and bounded scope above. The
  final prep-pr review reran the focused 97 tests and complete 229-test owner on
  `a09ba670b`.
