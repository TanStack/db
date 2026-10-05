# Issue #1912 eager-index history oracle review

## Reviewed state and claim

- Base: `f09868ff` (`origin/main` at investigation).
- Reviewed executable head: `106409550d4d6fdc7721fbe1952a59e5891d1f29`.
- Owner: `packages/db/tests/change-event-history-oracle.test.ts`.

Issue #1912 reports that a same-tick delete and reinsert can leave an eager
auto-index without the reinserted rows. That failure does not reproduce on the
reviewed `origin/main`. This change adds coverage for the affected Collection
mutation path. It does not change production code or claim to fix the reported
version.

The oracle starts with two rows, builds an eager index through a live query,
deletes both rows, and reinserts both keys in the same turn. The driver runs
this prefix with BasicIndex and BTreeIndex. It also runs legal generated tails
with batched and sequential settlement. In the batched lane it compares public
rows and index equality buckets with an independent row Map immediately after
each mutation returns, without awaiting settlement between mutations. The
batched lane checks again after all transactions persist; the sequential lane
checks after each persisted mutation. At the final checkpoint, fresh indexed
`eq` queries must return the Map's full rows.

## Generated grammar controls

- **Reconstruction:** The fixed prefix represents the reported replacement
  transition after index construction. The empty tail preserves that prefix.
  Both execution modes are fixed cases as well as generated choices. The issue's
  initial insert setup, batch `delete`, and string keys are outside this driver's
  setup. A separate temporary probe of that exact setup passed on current main;
  it is not a checked-in replay.
- **Ablation:** The fixed prefix guarantees the same-turn replacement path.
  Without the batched mode, that path is absent. The sequential mode checks
  settled intermediate states. Tail keys 3 and 4 admit new rows after the
  replacement. `deleteWhenPresent` admits further delete/reinsert histories.
  An empty tail checks the fixed prefix alone. Longer tails exercise repeated
  changes across both equality buckets.
- **Range:** Initial keys are 1 and 2. Tails contain 0 through 12 actions on
  keys 1 through 4. The indexed field has two stable values, `f1` and `f2`.
  Both index types run for every generated history; each history selects one
  settlement mode. The four fixed cases cross both index types and modes.
- **Exclusion:** The presence grammar inserts an absent key and updates or
  deletes a present key. It cannot insert a present key or update or delete an
  absent key. The existing bounded grammar has a separate missing-key check.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass. Issue #1912 supplies the expected public `eq` result after replacement. The existing Collection change-event contract supplies settled row and mirror agreement. The executable opening and coverage map limit this lane to local-only persistence, returned-mutation optimistic state, and settled checkpoints. No bug on current main is claimed. |
| ORC-002: independent judgment | Pass. `expectedRowsAfter` applies insert, update, and delete to a plain Map. Expected buckets filter that Map by the fixture's `fileId`. The model imports no index classifier or mutation state machine. |
| ORC-003: visible responsibilities | Pass. The executable opening states the contract. The Map model, presence grammar, Collection driver, and comparisons remain in the owner file. |
| ORC-004: grammar controls | Pass within the bounded domain above. The fixed prefix reconstructs the relevant replacement transition. The controls name the contribution of each axis, marginal ranges, and forbidden operations. |
| ORC-005: path and observation | Pass. A query builds the eager index before public Collection mutations. The driver verifies the chosen index constructor. It observes public rows and equality buckets after each returned batched mutation, settled public rows and change-message mirror rows, and fresh public query rows. The query check verifies that the named index's `eq` lookup ran. The row recorder retains full values but deliberately does not assert change-message multiplicity or batch shape. |
| ORC-006: checker calibration | Pass for the named comparisons. A temporary production mutant that skipped index updates reached the fixed batched checkpoint; its index count was 1 against 2 model rows and failed by assertion. A temporary mutant that made index add, remove, and update no-ops survived final-only checks when the replacement restored the original keys, then failed the new synchronous prefix count immediately after the first delete (`2` versus `1`). A separate wrong-result control made the named index lookup return no keys after the direct checks; the fresh public query comparison failed with `[]` versus the expected `f1` row. These were assertion failures, not timeouts or setup failures. All temporary faults were removed. The executable checker also rejects a removed live key. These controls demonstrate sensitivity to their specific faults, not detection of a current production bug. |
| ORC-007: campaigns and replay | Pass. The same generated property runs with fixed seed 1912 and with an unseeded random campaign, 35 runs each. A temporary wrong-result control at the final query produced a generated failure with seed `584849211` and path `0:0`, shrinking once to the fixed four-operation batched prefix. Direct replay with `TANSTACK_DB_ORACLE_PROPERTY=collection-state.eager-index-history`, that seed, and that path reproduced the same public query mismatch with zero further shrinks. The same requested replay passed after the control was removed. This is a replay of an injected failure, not a captured failure on main. |
| ORC-008: model minimality | Pass. The tail grammar retains only key presence because that decides whether insert, update, or delete is legal. The expected row Map retains values because row and bucket comparisons distinguish them. No index lifecycle state was added to the model. |
| ORC-009: vocabulary mapping | Pass. `present` means keys eligible for update or delete. The row Map represents expected public Collection rows at the returned-mutation and settlement checkpoints; it does not represent the production index or optimistic transaction machinery. |
| ORC-010: failure and cleanup | Pass. Query cleanup and Collection cleanup run after assertions. When an assertion and cleanup both fail, `AggregateError` preserves the primary failure as `cause` and retains cleanup errors separately. |
| ORC-011: second formulation | Not applicable. Review found no plausible semantic fault shared by the Map model and production that requires a second reference formulation. Direct index buckets and fresh queries are complementary observations, not independent reference models. |

This record supplies ORC-012 evidence for executable head `10640955`. The
versioned record is being updated after that code commit; no production code
changed in this pull request.

## Verification and remaining scope

The change-event owner and replay tests passed: 403 tests. CI exposed type
inference errors in the owner file at the first reviewed commit. The follow-up
commit fixed the generic key type. The owner passed 376 focused tests after the
synchronous-prefix check was added. Changed-file ESLint, Prettier, and
`git diff --check` passed. The package TypeScript check reported no owner-file
errors; it still reports unresolved `@tanstack/db` imports in two conformance
files. The direct failure replay reproduced the injected query mismatch at its
public checkpoint, and passed after the control was removed.

The oracle does not inspect an index during a change callback. An index error
visible only inside a callback can still escape the returned-mutation and
settled checks. It does not cover adapter cancellation, non-local-only
persistence, or the issue's original seed-by-insert and string-key setup.
Generated tails are structurally reachable, but 35 random runs do not guarantee
any particular adjacent tail. The change-event history owner retains the
callback boundary. The Collection lifecycle owners in the coverage map retain
adapter paths.
