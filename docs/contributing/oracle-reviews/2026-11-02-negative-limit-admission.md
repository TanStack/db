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


## Reviewed production head

The tested production head is `46058c58c36d26d8dcdc921f5d70b008a4d5fe65`.
Its `packages/db/src` tree is `476f38cff16ffc97a67ce103f7d73789fe4e1ef1`.
The subsequent evidence/changeset commit changes no production source or oracle.

## Size and review follow-up (2026-11-02)

This entry supersedes the earlier size result. Reviewed and tested head:
`e7957c56a6b80b314fdbdcfded6f308284e81c4d`.
Its `packages/db/src` tree is `400ef43d38f69b6347fa32bb3526c30be32373b6`.
The admission companion blob is `1d85c87b2e0266b7b5b68ddb35dfccb0f9d192f1`.

### Law, experiment and inference

The existing builder and window contracts remain fixed. Negative limits still
throw synchronously before mutation; valid neighbors and existing guard
precedence remain unchanged. The builder and window utility JSDoc additionally
promise RangeError. The shared admission comparison previously checked only
whether the operation threw, discarding the recorded error value.

The oracle comparison was strengthened before the production refactor. It now
checks the complete discriminated outcome and requires RangeError on rejection.
Unchanged production passed all 24 admission campaigns. Replacing RangeError
with Error, and separately throwing undefined, each failed all 12 negative
campaigns at the intended error-class comparison. Neither failed during setup,
crashed, timed out or survived. Both mutations were restored. This is a checker
repair: the original production class was already correct, so its baseline is
GREEN rather than a claimed production RED.

The same six receivers, grammar, budgets, sign model and observation cuts
remain. Each campaign reaches admission in 21 histories; the five window
receivers also reach next use in 21; each pending receiver reaches its held
premise in 21. No assertion, input dimension, path or run budget was removed.
The original oracle-first RED and eight earlier mutant results remain recorded
above. ORC-001 through ORC-016 retain their earlier accounting; the new class
comparison supplies additional ORC-005/006 enforcement without changing the
independent model, history grammar or scope.

### Production reductions

All reductions preserve existing behavior for constructed immutable queries:

- Merge query clauses once in the private clone helper, replacing 16 repeated
  spreads. Explicit undefined still clears regular or functional selection.
- Delete the single-source wrapper's duplicate cardinality check. Its surviving
  validator already requires exactly one key for both FROM and JOIN before
  reading source values, then creates exactly one reference or throws.
- Remove the dead saved active window operation. The existing reentrancy guard
  rejects an active operation; the synchronous operation still clears in finally.
- Share WHERE/HAVING reference conversion and expression validation. Conversion
  remains conditional, so invalid primitive callback results remain rejected.
- Inline the one remaining type-description use, retaining null's special name
  and deleting branches that duplicated typeof's result.

The removed private wrapper's stale mangle entry was deleted. Other mangle
assignments, lifecycle guards, errors and recovery paths remain unchanged.
Injected mutable accessors through internal query IR or the internal owned
constructor path are outside the query-construction equivalence claim.

### Validation and shipped weight

From `packages/db`:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm exec vitest run tests/query/builder tests/query/pagination-oracle.property.test.ts tests/query/pagination.test.ts tests/query/live-query-collection.test.ts tests/live-query-window-controller.test.ts tests/production-error-messages-oracle.test.ts tests/query/aggregate-select-oracle.property.test.ts tests/query/ir-stable-identity-oracle.test.ts --maxWorkers=2 --coverage.enabled=false
```

All 754 tests in 20 files pass, with no type errors. Test TypeScript compilation,
changed-file lint, the private-mangle check, formatting and diff checks pass.
The consumer error check verifies 264 literals, including 22 shared literals,
are erased in production and retained in development for ESM and CommonJS.

The exact-baseline command in the earlier size section reports:

| Bundle | Gzip delta | Brotli delta |
| --- | ---: | ---: |
| Typical app | -6 bytes (96,323 to 96,317) | -209 bytes |
| Full db exports | -21 bytes | +27 bytes |

All eight app scenarios shrink in gzip. Brotli varies by scenario; Effect,
includes, join and local-storage scenarios still grow. This claims a net
reduction for the typical app in both compression formats, not every bundle.
The builder contributes 352 fewer minified bytes; the validator adds 59 and
the live builder adds 7, for 286 fewer minified app bytes overall. Names,
comments and formatting were not shortened to obtain these results.

### Review evaluation and loss audit

The comprehensive review and two delegated oracle reviewers found one item:
R1, the missing runtime error-class comparison. It is confirmed and fixed.
The simplifier's S1 clone merge, S2 dead-operation save, S3 redundant source
wrapper and S4 shared condition validation were evaluated separately and applied.
S5, the redundant type-description helper, was found during implementation and
independently reviewed. The sections above record each repair and its evidence.

The final production and comparison changes received another source review;
both delegated reviewers used oracle-review. No new findings remained. Their
inspection does not substitute for the executed results above. The reviewers
identified a precise enforcement gap and justified the simplifications while
leaving byte savings to measurement.

No known in-scope counterexample remains. The earlier provider, framework,
raw-IR and numeric-policy limits remain. Local validation is complete; whole-PR
readiness still requires creating the new follow-up PR and checking its CI.

## Published replay-manifest repair

PR #2333 CI found that the source-name integrity test treated the admission
family as literal names. At head `7fd0d09ef`, the focused command from
`packages/db` failed at the source-mapping comparison:

```sh
pnpm exec vitest run tests/oracle-replay.test.ts -t 'maps literal owners' --maxWorkers=2 --coverage.enabled=false
```

The repair validates the six receiver names, both admission names, and the
computed source template, following the existing computed-family checks.
All twelve admission names also enter the existing guarded direct-replay
comparison, which requires exactly one executed property. No name is exempted
from source validation; no oracle model, comparison, production code or run
budget changed. The full command passes all 82 tests without type errors:

```sh
pnpm exec vitest run tests/oracle-replay.test.ts --maxWorkers=2 --coverage.enabled=false
```

Changed-file lint and formatting pass. The published documentation review also
removed an inaccessible local-ledger citation and a reviewer hiring remark;
the technical findings and measured evidence remain above.
