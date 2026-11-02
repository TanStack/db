# Negative limit admission

## Oracle-first gate

Production base: `30e85464ed2b9b12c5f10981a062427a1fc8daaa` (merged #2316).
No production file changed before the following RED runs. This follow-up has
its own evidence; the merged PR's results are not credited here.

- **Law and authority:** maintainer decision on 2026-11-02 in the #2291/#2316
  follow-up: negative limits must throw. A rejected `.limit()` preserves its
  builder; rejected `setWindow` preserves the existing window and demand.
  This rejects admission, rather than defining a negative-width result.
- **Receiving paths:** all supported `.limit()` calls use BaseQueryBuilder;
  callback/config/liveQueryCollectionOptions paths receive that builder.
  `utils.setWindow` is bound to CollectionConfigBuilder. The companion runs
  construction, unstarted, ready, initial-pending, move-pending and
  replay-pending receivers separately. Adapter reuse already excludes negative
  targets; window-controller page sizes normalize them. Neither creates a
  separate negative-input receiver. This claims no framework error timing.
- **Reach:** each fixed and random campaign has one example plus 20 generated
  histories. Each valid history tests 0, -0, a generated positive integer and
  Infinity in fresh fixtures. Pending campaigns assert an unfinished operation
  and held acquisition before each candidate. Negative histories test -2,
  -0.5, -Number.MIN_VALUE, -Infinity and a generated negative magnitude, with
  both omitted and supplied offsets. Reach checks admission, next use and held
  work separately per receiver/campaign.
- **RED:** from `packages/db`, run
  `TANSTACK_DB_ORACLE_STATISTICS=1 pnpm exec vitest run tests/query/pagination-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false -t 'negative limit admission'`.
  Result before production edits: 12 intended negative admission assertion
  failures; 12 valid-neighbor campaigns pass, each reaching every declared
  state in 21 histories. Type checking reports no errors. The initial wrong
  createLiveQueryCollection call was a setup error and supplies no RED credit;
  it was repaired before these runs.
- **Generated RED and replay:** each of the six negative properties also fails
  at its own admission-return comparison under seed 2291, path 1, through
  `node --import tsx tests/oracle-replay.ts tests/query/pagination-oracle.property.test.ts --maxWorkers=2 --coverage.enabled=false` with
  `TANSTACK_DB_ORACLE_PROPERTY=pagination.limit-admission-<receiver>-negative`,
  `TANSTACK_DB_ORACLE_SEED=2291`, `TANSTACK_DB_ORACLE_PATH=1`.
  The manifest selects the random test directly; no manual name filter is used.
  The guarded witness records one failed execution of the requested property.
- **Limits:** ordinary ordered list queries, fully installed finite source
  rows, and controlled acquisition settlement. Provider row delivery,
  framework error timing, raw IR, NaN, positive fractional widths and raw IVM
  negative widths are not claimed. findOne has its existing fixed-limit law;
  this does not promise unrestricted positive limits there or revise error
  precedence for queries already rejected by another guard.

## Independent review and instrument repairs

Three reviewers used oracle-review before production edits. Source-inspected
findings were resolved in the oracle before the final RED gate:

- Copy authored builder bounds; do not compare a live IR object with itself.
- Record a discriminated thrown outcome, including thrown non-Error values.
- Yield while acquisitions remain held before comparing unchanged facts.
- Compare every accepted candidate's rows and bounds at its own settlement.
- Give each accepted pending candidate its own held fixture.
- Add held source replay: a guard after pendingSourceRecovery would miss it.
- Add direct manifest replay selection and a valid negative-offset neighbor.

The reviewers ran no tests. Their source review is not GREEN evidence.

## Guide accounting

ORC-001/002/003: the maintainer sign decision, a pure sign model and an identity
relation on captured observations remain separate from production. Rank
selection is an independent full sort and absolute-rank predicate. Prose names
the grammar, public entry points and cuts beside the driver.

ORC-004/008/009: ranks -5..5, 12 unique keyed rows, initial offsets 0..2,
initial limits 1..3 and negative magnitudes 1..1,000,000 vary the reported
history. Explicit threshold values retain fractions, the smallest negative
number and infinity. Removing the held/replay/partial-bound/source-update axes
loses their corresponding observation. NaN and positive fractions are excluded
because the decision does not settle their policy. The identity relation needs
only captured public observations; it duplicates no lifecycle state machine.

ORC-005/013/014/015: receiver-specific admission-return, next-turn while held,
settled rows, inherited partial bounds and source-update observations check the
promised boundaries. Zero and tiny negative distinguish a misplaced threshold;
a negative-offset neighbor rejects a guard against all negative bounds. The
controlled source's whole source is installed before its loads; there is no
claim that a provider supplies that premise. Per-receiver declared reach is
asserted. No concrete missing-input hypothesis arises for a synchronous sign
check, whose argument is available at admission.

ORC-007/010: both campaigns use the same grammar, examples, recorder, comparison
and budget; only seed choice differs. The guarded replay checks the requested
seed/path directly. Failure fidelity retains the first law/checkpoint and
original/reduced histories; cleanup preserves primary and secondary failures.

ORC-011: no distinct shared-semantic-fault hypothesis needs another model; the
sign and identity laws have no incremental algorithm. ORC-016: examples and
generated histories use the same model/driver/checker; no unit assertions with
a separate expected answer are added. ORC-006 and ORC-012 closure use the repair and hostile-mutant evidence below.


## Repair evidence

The oracle-first commit is `7ecf97dff2afb772e35970c095be83ecb11a188e`.
It contains the reviewed oracle and RED record with no production repair.
The repair uses one internal validator at builder cloning and before the live
window records a request generation. The existing findOne, order and reentrant
checks keep their ordering. No public method or error class is added.

- **GREEN:** from `packages/db`, run
  `TANSTACK_DB_ORACLE_STATISTICS=1 pnpm exec vitest run tests/query/pagination-oracle.property.test.ts tests/query/pagination.test.ts tests/query/live-query-collection.test.ts tests/live-query-window-controller.test.ts tests/production-error-messages-oracle.test.ts --maxWorkers=2 --coverage.enabled=false`.
  All 533 tests in five files pass. All 24 new campaigns pass. Every declared
  state is reached by 21 histories in its own campaign: admission on all six
  receivers, next use on all five window receivers, and held work on each
  initial/move/replay receiver. Each valid history reconstructs all four
  candidates with separate fixtures. One example plus 20 generated histories
  runs in both fixed-seed and fresh-seed campaigns.
- **Replay:** all twelve receiver/category properties pass the guarded replay
  command above at seed 2291/path 1, each with exactly one witnessed execution.
- **Checks:** `pnpm exec tsc --noEmit -p packages/db/tsconfig.test.json`,
  `pnpm lint:changed`, and `git diff --check` pass. The consumer bundle check
  `pnpm test:production-errors` verifies 264 development literals (22 shared)
  are erased in production and retained in development in ESM and CommonJS.
  The new error site uses code 261 and built-in RangeError.

### Hostile mutations

Each mutation ran against a generated history through the guarded replay at
seed 2291/path 1. All eight failed by an oracle comparison, not setup failure,
crash or timeout. Mutations were restored after each run.

| Wrong implementation | Rejected observation |
| --- | --- |
| Remove builder validation | builder admission return |
| Remove window validation | ready window admission return |
| Reject zero with <= 0 | valid builder admission return |
| Reject only negative integers | builder admission of -0.5 |
| Validate after pendingSourceRecovery | replay-pending admission return |
| Mutate builder limit, then throw | authored builder bounds at admission return |
| Queue a valid window move, then reject the negative call | initial-pending settled window |
| Reject positive limits while ordered work is pending | valid initial-pending admission return |

The queued-move mutant is rejected at settlement. It does not show that a
private top-K mutation is publicly observable while the source is held. The
next-turn comparison observes only public facts while held; the later settled
and next-use comparisons protect changes that are visible only afterward.

### Shipped weight

`pnpm size:compare --packages db --base 30e85464ed2b9b12c5f10981a062427a1fc8daaa --exact-base --files`
reports db +23 gzip / +151 Brotli bytes. The typical application is +49 gzip /
-118 Brotli bytes. These are measured bundle deltas, not source-line counts.
The minified additions are 59 bytes for the single validator and 18 bytes for
its two callers. Sharing one error site avoids duplicate guards and diagnostics;
a default validation argument also removes an explicit undefined branch. No
existing lifecycle guard or recovery path becomes redundant under the new
admission law, so none is removed to pay for validation. This small growth is
the cost of checking the two previously unchecked public inputs.

### Closure boundary

The sign/admission defect is closed for the documented ordinary ordered list
receivers and generated histories at synchronous return, next turn while held,
settlement, partial-bound inheritance and subsequent source updates. This is
bounded evidence, not a proof for every history. The limits above remain;
in particular no raw-operator negative-width result law or additional numeric
validation policy is claimed. There is no known in-scope counterexample.
