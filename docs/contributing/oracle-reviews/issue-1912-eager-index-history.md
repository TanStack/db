# Issue #1912 eager-index history oracle review

## Reviewed state and claim

- Base: `f09868ff` (`origin/main` at investigation).
- Reviewed implementation head: `4645dc927d6855ff99f18ed17a9294511fff5102`.
- Owner: `packages/db/tests/change-event-history-oracle.test.ts`.

Issue #1912 reports that a same-tick delete and reinsert can leave an eager
auto-index without the reinserted rows. That failure does not reproduce on the
reviewed `origin/main`. This change adds coverage for the affected Collection
mutation path. It does not change production code or claim to fix the reported
version.

The oracle starts with two rows, builds an eager index through a live query,
deletes both rows, and reinserts both keys in the same turn. The driver runs
this prefix with BasicIndex and BTreeIndex. It also runs legal generated tails
with batched and sequential settlement. After each settled prefix, the oracle
compares index equality buckets with an independent row Map. At the final
checkpoint, fresh indexed `eq` queries must return the Map's full rows.

## Generated grammar controls

- **Reconstruction:** The fixed prefix represents the reported replacement
  transition after index construction. The empty tail preserves that prefix.
  Both execution modes are fixed cases as well as generated choices. The issue's
  initial insert setup and string keys are outside this driver's setup.
- **Ablation:** The fixed prefix guarantees the same-turn replacement path.
  Without the batched mode, that path is absent. The sequential mode checks
  settled intermediate states. Tail keys 3 and 4 admit new rows after the
  replacement. `deleteWhenPresent` admits further delete/reinsert histories.
  An empty tail checks the fixed prefix alone. Longer tails exercise repeated
  changes across both equality buckets.
- **Range:** Initial keys are 1 and 2. Tails contain 0 through 12 actions on
  keys 1 through 4. The indexed field has two stable values, `f1` and `f2`.
  Both index types and both settlement modes run for every generated history.
- **Exclusion:** The presence grammar inserts an absent key and updates or
  deletes a present key. It cannot insert a present key or update or delete an
  absent key. The existing bounded grammar has a separate missing-key check.

## ORC-001 through ORC-011

| Requirement | Outcome |
| --- | --- |
| ORC-001: authority and limits | Pass. Issue #1912 supplies the expected public `eq` result after replacement. The existing Collection change-event contract supplies settled row and mirror agreement. The executable opening and coverage map limit this lane to local-only persistence and settled checkpoints. |
| ORC-002: independent judgment | Pass. `expectedRowsAfter` applies insert, update, and delete to a plain Map. Expected buckets filter that Map by the fixture's `fileId`. The model imports no index classifier or mutation state machine. |
| ORC-003: visible responsibilities | Pass. The executable opening states the contract. The Map model, presence grammar, Collection driver, and comparisons remain in the owner file. |
| ORC-004: grammar controls | Pass within the bounded domain above. The fixed prefix reconstructs the relevant replacement transition. The controls name the contribution of each axis, marginal ranges, and forbidden operations. |
| ORC-005: path and observation | Pass. A query builds the eager index before public Collection mutations. The driver verifies the chosen index constructor. It observes settled public rows, change-message mirror rows, equality buckets, and fresh public query rows. |
| ORC-006: checker calibration | Pass. A temporary production mutant that skipped index updates reached the fixed batched checkpoint. The index count was 1 against 2 model rows, so the assertion failed. This was an assertion failure, not a timeout or setup failure. The mutant was restored. The executable checker also rejects a removed live key. |
| ORC-007: campaigns and replay | Pass. The same generated property runs with fixed seed 1912 and with an unseeded random campaign, 35 runs each. The registered direct replay for `collection-state.eager-index-history`, seed 1912, path `0` completed 35 runs with one execution witness. |
| ORC-008: model minimality | Pass. The tail grammar retains only key presence because that decides whether insert, update, or delete is legal. The expected row Map retains values because row and bucket comparisons distinguish them. No index lifecycle state was added to the model. |
| ORC-009: vocabulary mapping | Pass. `present` means keys eligible for update or delete. The row Map represents expected Collection rows after settlement; it does not represent the production index or optimistic state. |
| ORC-010: failure and cleanup | Pass. Query cleanup and Collection cleanup run after assertions. When an assertion and cleanup both fail, `AggregateError` preserves the primary failure as `cause` and retains cleanup errors separately. |
| ORC-011: second formulation | Not applicable. Review found no plausible semantic fault shared by the Map model and production that requires a second reference formulation. Direct index buckets and fresh queries are complementary observations, not independent reference models. |

This record supplies ORC-012 evidence for the reviewed implementation commit.

## Verification and remaining scope

The change-event owner and replay tests passed: 403 tests. CI exposed type
inference errors in the owner file at the first reviewed commit. The follow-up
commit fixed the generic key type. The owner then passed 376 focused tests, and
the package TypeScript check reported no owner-file errors. Changed-file
ESLint, Prettier, and `git diff --check` passed. The direct replay completed
with the requested property, seed, and shrink path.

The oracle does not inspect an index during a change callback. It does not
cover adapter cancellation, non-local-only persistence, or the issue's original
seed-by-insert setup. The change-event history owner retains the first boundary.
The Collection lifecycle owners in the coverage map retain adapter paths.
