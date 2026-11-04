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

## Ten-item follow-up review

The review was evaluated against published head
`56287b7f4956012fd65087a6e46db1d8854fe8bd`. Production admission behavior stayed
unchanged. The public-entry, raw-IR and numeric-policy limits above still apply.

| Item | Result and action |
| --- | --- |
| 1. Missing error 261 docs | Confirmed by `node scripts/generate-error-docs.mjs --check`. Regenerate the committed page and add a CLI integrity check of the repository page, alongside the existing fixture checks. Generation also refreshes error 206's stale source path. |
| 2. RangeError precedence | Executed public probes confirm all three earlier guards. Document their precedence explicitly and list the reentrancy error. The changeset promises rejection before mutation; it does not promise a particular class before these guards. |
| 3. Native error class | Keep the accepted RangeError contract. A new exported error class would add API surface. The existing error page explicitly distinguishes coded native errors from named TanStack error classes. |
| 4. Raw IR and TopK | The exact negative-width counterexample remains in the coverage map outside the supported raw-operator law. A compiler-only guard cannot replace synchronous builder admission or window moves, which do not recompile. No compiler contract is added. |
| 5. NaN and null | Executed probes confirm both can pass the runtime comparison. NaN policy remains undecided; null is outside the number-typed input. This negative-limit repair does not introduce general numeric-input validation. |
| 6. Operation settlement | Confirmed instrument gap. Observe the exact admitted operation outcome before cleanup and compare it at a named settlement checkpoint. Generation corruption now gives a comparison failure with a replayable reduced history. |
| 7. Corrupt settled window | The proposed settledWindow mutant already fails the original admission-return comparison: getWindow reads settledWindow. Preserve the distinct useful idea by adding failed held moves; a different rollback-currentWindow mutant survives the old grammar and fails the extension's partial-next-use check. |
| 8. Rejected-value diagnostic | The omission is confirmed. Current coded diagnostics identify the invalid limit and code 261; no accepted contract promises its value. Retain this as a diagnostic design proposal without changing production message inputs or shipped bytes. |
| 9. Condition return type | Constrain the internal helper's input and output to BasicExpression, the existing WHERE/HAVING IR condition type. Keep the runtime classifier and public callback signature unchanged. TypeScript validates the cleanup. |
| 10. Shared source invariant | Executed FROM/JOIN probes reject empty and multi-source objects before use and admit single-source neighbors. Their literal contexts cannot take the union exception. Retain the shared invariant without restoring a redundant wrapper or assertion. |

### Settlement law and experiments

The accepted rejection-identity law includes the outcome of an operation that
was already admitted. Atomic window publication also requires a failed move to
keep the previous settled window and public rows. The extension records promise
settlement before releasing controlled acquisitions. It compares fulfillment,
rejection identity, window bounds and independently selected rows, then performs
a partial retry and a source update. Every generated move-pending negative
history executes both successful and failed acquisition schedules. Other pending
receivers retain their successful schedules; this adds no initial-load or replay
failure-policy claim.

The unchanged original instrument passes all 24 admission campaigns. Its
request-generation mutant produces an unmarked chaining-cycle failure for a
held move and a timeout during replay. Those are not named-comparison kills.
With the extended instrument, the same mutation fails the held-move and replay
settlement comparisons. Guarded generated replay uses
`pagination.limit-admission-replay-pending-negative`, seed `2291`, path `1`;
the witness records one requested execution and a reduced failure at
`replay-pending settled`.

The settledWindow mutant fails the original `limit admission` return comparison
on both held-move and replay paths. The distinct rollback mutant changes only
`currentWindow = settledWindow` in the asynchronous rejection handler to an
invalid width. It passes the original two negative fixed campaigns and fails
the extension at `move-pending source update`, where the partial retry reports
limit -2 instead of the original positive limit. These are separate outcomes.
All temporary production mutations are restored.

Two fresh agents used oracle-review for source inspection. One found that the
first extension required completion after one timer turn. A control that defers
successful settlement with `setTimeout(resolve, 0)` confirms that false rejection.
The repair waits for the recorded completion, with an explicit one-second
**diagnostic budget**, before comparing the observed outcome. It clears the
deadline timer. The same task-scheduled control passes afterward. This is bounded
progress evidence for the controlled fixture, not a product deadline or proof
about arbitrary provider timing. The campaign allows 30 seconds so repeated
bounded waits during shrinking can preserve a named failure. Seed, run count,
fixed examples and random-campaign parity remain unchanged.

ORC-001/002/003/005: the original sign and identity authority remains; the new
outcome judgment derives from the injected acquisition result, independently
of production generations. Prose distinguishes acquisition settlement from
publication and names each comparison. ORC-004/008/009: both outcome schedules
share every generated payload; removing failure loses the rollback distinction,
and removing settlement observation loses the generation comparison. Existing
rank and width bounds remain unchanged. The previous settled window is necessary
because failure and success have different legal next observations.
ORC-006/007/010/013/015: mutants and the legal scheduling control distinguish
wrong state, a stalled operation and permitted asynchronous timing. Named
comparisons preserve original/reduced traces and exact rejection identity;
cleanup still releases held work. Declared successful/failed settlement reaches
supplement the existing per-receiver reaches. Both campaigns keep 20 generated
histories plus their shared example. ORC-011 introduces no second formulation:
no shared semantic fault hypothesis needs another model. ORC-014 remains limited
to controlled acquisition settlement, with no provider-delivery or framework
claim. ORC-016 adds no unit examples to the oracle. The committed-page check is
an ordinary CLI artifact-integrity test in its existing ordinary test file.


### Final follow-up verification

The tested tree is based on `56287b7f4956012fd65087a6e46db1d8854fe8bd`.
The only production changes in this follow-up are the internal condition type
and the error-precedence JSDoc. Neither changes emitted runtime behavior. All
temporary mutations were restored before the final checks. The following
SHA-256 values identify the tested production and instrument sources:

| Source | SHA-256 |
| --- | --- |
| `packages/db/src/query/validate-limit.ts` | `f4838c2d3bedfffa869ef205dc2f16515183c17b8f6502feee7978a65d588014` |
| `packages/db/src/query/builder/index.ts` | `2c88c4c32ae9dd7d84267248b29a7e17907bad3652f6a246e156913a8accb4ed` |
| `packages/db/src/query/live/collection-config-builder.ts` | `31c7a438095ea7b23a0d09ce73f1d5c2089d20b5ec4b140aa3c9d5047e651175` |
| `packages/db/tests/query/limit-admission-oracle.ts` | `433391cb0fd2c840e0fda53f7738e75dbe474154b7ede7fb1de74032d9c8375b` |
| `packages/db/tests/generate-error-docs.test.ts` | `26efa3154b6f796aa661c290f93b8bdd34aea98b963ae4765e84428f5c077f29` |

From `packages/db`, the final selected suite passes **772 tests in 22 files**,
with no type errors:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 pnpm exec vitest run tests/query/builder tests/query/pagination-oracle.property.test.ts tests/query/pagination.test.ts tests/query/live-query-collection.test.ts tests/live-query-window-controller.test.ts tests/production-error-messages-oracle.test.ts tests/query/aggregate-select-oracle.property.test.ts tests/query/ir-stable-identity-oracle.test.ts tests/generate-error-docs.test.ts tests/error-docs-commands.test.ts --maxWorkers=2 --coverage.enabled=false
```

The final guarded replay suite passes **82 tests**, with no type errors:

```sh
pnpm exec vitest run tests/oracle-replay.test.ts --maxWorkers=2 --coverage.enabled=false
```

The successful-settlement reach is 21 histories for each pending fixed/random
campaign. Each negative move-pending campaign also reaches failed settlement
in 21 histories. The generated generation-mutant replay fails the named
settlement comparison and reduces to path `1:0:0:0:0:0:0:0:0:0:0:0`; it records
one requested execution and finishes in 13.74 seconds without a CLI timeout
override. The restored branch is GREEN. The distinct rollback mutant fails
its next-use comparison. The valid task-scheduled settlement control passes.

The committed-page control rejects the old page with the generator's
`docs/errors.md is out of date` diagnostic. The regenerated page passes
`node scripts/generate-error-docs.mjs --check`. Test TypeScript compilation,
`pnpm lint:changed`, direct type-aware ESLint, formatting and `git diff --check` pass. No oracle run
budget decreased. The complete root `pnpm test` was not run locally.

Shipped size was remeasured against the exact merged baseline
`30e85464ed2b9b12c5f10981a062427a1fc8daaa`:

```sh
pnpm size:compare --packages db --base 30e85464ed2b9b12c5f10981a062427a1fc8daaa --exact-base --files
```

The typical app remains **-6 gzip bytes** (96,323 to 96,317) and **-209 Brotli
bytes**. Full db exports change by -21 gzip bytes and +27 Brotli bytes. All
eight app scenarios decrease in gzip; Brotli varies by scenario. These results
do not establish arbitrary provider timing, framework error timing, raw-IR
admission, NaN policy, or negative-width IVM result semantics.


The pre-commit type-aware lint found that the narrower helper input made the
null diagnostic appear unreachable. The final helper keeps its runtime guard
and widens only that diagnostic operand to unknown, because JavaScript callers
can violate the callback's static type. This type assertion emits no code.
The selected 772-test suite and type-aware lint pass again on that final source;
the source table above includes it. The oracle source is unchanged from its
82-test guarded replay run.
