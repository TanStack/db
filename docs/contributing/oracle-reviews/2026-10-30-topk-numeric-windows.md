# Top-K numeric window evidence

This record extends the support-window owner during the #2291 adapter-window
repair. The oracle changed before `TopKArray` changed. Reviewed base:
`c351fc04d7f70dc59bf92ecbed310f899b9511cd`.

## Law and owner

The fractional-index top-K offset/limit API selects positive support by ordered
rank. Nonnegative safe-integer authored bounds must return a finite installed
result. A partial move keeps the exact authored bound that it omits. An offset
and a width describe the requested window independently of installed support.

The top-K operator API supplies the selection and partial-options authority.
The live-query architecture's “Ordered requests, continuation, and recovery”
contract requires the graph to revisit changed ordered demand. At this operator
boundary, a changed nonempty requested window emits an output message even when
no installed rank enters or leaves. Additional messages are permitted, including
when both requested windows are empty. This is not a callback-count promise.

Primary owner:
`packages/db-ivm/tests/operators/topk-support-window-oracle.test.ts`.
The existing signed-support law and its 100-history budgets remain in place.
The added `ivm.topk-numeric-window` property uses the same row-relation checker.

## Independent model and legal histories

The model stores authored offset and limit separately. It selects each present
key by `rank >= offset && rank - offset < limit`. It neither adds the bounds nor
enumerates absent ranks. A later offset-only return can therefore distinguish
width two from a rounded width one, even while both earlier installed windows
were empty.

The generated input varies installed positive typed keys (3–5), distance from
`MAX_SAFE_INTEGER` (0–2), finite width (2–4), and an empty-range gap (1–3).
Each of four profiles runs a shared eight-move history:

- `offset`: a near-maximum offset with a small width.
- `width`: a near-maximum width from offset zero.
- `partial`: near-maximum offset with width two, followed by offset-only zero.
- `demand`: a finite window beyond installed support.

Every profile then crosses changed empty installed ranges, width growth,
zero-width windows, an offset-only zero-width change, and a return to installed
rows. The fixed example is an input to this shared history builder, model,
production driver and comparison. Both normal campaigns use the same generator,
recorder, checker and 100-history budget; the fixed seed is 2291.

Reconstruction includes the reported maximum-offset/width-three hang, huge
width, rounded retained width, and changed-but-uninstalled demand. Removing
near-maximum bounds loses the arithmetic defect; removing partial options loses
the exact-width defect; removing the empty-range gap loses the lost-demand
mutant. Negative, fractional and unsafe authored bounds are excluded. The
production paths are the ordinary and single-group fractional-index top-K
operators. Observations occur after each move returns and its graph run ends:
complete signed indexed output, reported size, and required demand messages.

## RED before the production change

Unchanged `TopKArray` blob:
`5de9b6f300ffc1da5e425a63ab11251295ca4b83`.

The subprocess command was:

```sh
pnpm --filter @tanstack/db-ivm exec vitest run \
  tests/operators/topk-support-window-oracle.test.ts \
  -t "Numeric window oracle: 'array'.*preserves offset bounds.*fixed campaign" \
  --coverage.enabled=false --typecheck.enabled=false --silent=false
```

The watchdog launched this command in a new process group, streamed its output,
and killed that group after a fixed-history move-entry marker failed to return.
The marker was written directly to the subprocess file descriptor so Vitest's
buffered console forwarding could not hide entry. Startup had a separate
20-second bound. The final guarded runs used a 10-millisecond post-entry bound
and a 256-MB V8 heap cap. This bound is a diagnostic stop, not a product CPU-time
threshold. Source inspection separately establishes the offset-three loop:
incrementing `9007199254740992` no longer advances toward its greater end.

| Path/profile | Actual pre-repair result |
| --- | --- |
| array, offset | Timeout after entering `{offset: 9007199254740991, limit: 3}`; process group killed, exit -9. |
| grouped, offset | Same move-entry timeout, exit -9. |
| array, width | Timeout after entering `{offset: 0, limit: 9007199254740991}`; exit -9. |
| array, partial | Row assertion RED at move 1: one row after offset-only zero, model requires two. Fixed campaign reported seed 2291, path `0:0:0`. |
| grouped, partial | GREEN: its wrapper separately retains the authored width. Both declared reaches were 100. |
| array and grouped, demand | GREEN. The grouped final run reports both declared reaches as 100. |

These outcomes are distinct. Timeouts did not reach the post-return comparison
and are not assertion kills. Initial offset/width probes exhausted the capped
worker heap; those are runtime failures after setup, outside the intended
comparison. A preliminary command selected no tests and supplies no evidence.
The final timeout logs contain the move-entry marker and no heap failure.

Raw development logs are retained under `review-2291/topk-numeric-*`. The checked
commands, state markers, failure trace and exact results above preserve their
verdict-critical contents in this versioned record.

## GREEN, reach and calibration

The production repair stores the exact authored width, clamps output-difference
intervals to installed support, and derives demand changes from authored bounds.
Production GREEN blob: `85b58a7de32bc881179b2c85955f9f3773d27319`.
Oracle blob: `627eee1e6c8a34eb6b3e5274be42cf405006d4ab`.

The focused top-K run passed 172 tests in five files. Its numeric lane ran both
operators, all four profiles and both campaigns. In each of those 16 cells,
`createOracleReach` reported 100 histories for the profile-specific completed
move and 100 for the return to installed rows. The fixed example reached each
declared state. The RED timeout has no completed-move reach; its direct entry
marker establishes the attempted boundary instead.

The original source supplies timeout/runtime and row-assertion RED controls.
Three additional hostile mutants failed intended assertions:

| Mutant | Rejection |
| --- | --- |
| Derive `changes` only from clipped installed intervals | Both operators and both campaigns fail the demand assertion at move 3: changed nonempty requested windows both select no installed row, but emit no demand message. |
| Recover omitted width as computed end minus offset | The ordinary operator's partial profile fails the row assertion at move 1: one row instead of two. |
| Store clamped bounds as the authored window | The shared React receiving history fails its row comparison when source growth installs rows after a huge-offset or huge-width move. |

These are assertion kills, not timeout or setup failures. The source was restored
after each mutant. Development logs are `review-2291/mutant-clipped-demand.log`,
`mutant-rounded-width.log`, and `mutant-stored-clamp.log`.

The direct replay was then checked sequentially against the rounded-width
mutant and repaired production:

```sh
TANSTACK_DB_ORACLE_PROPERTY=ivm.topk-numeric-window \
TANSTACK_DB_ORACLE_SEED=2291 \
TANSTACK_DB_ORACLE_PATH=0:0:0 \
pnpm --filter @tanstack/db-ivm exec vitest run \
  tests/operators/topk-support-window-oracle.test.ts \
  -t "Numeric window oracle: 'array'.*preserves partial bounds.*random campaign" \
  --coverage.enabled=false --typecheck.enabled=false --silent=false
```

The mutant reproduced the row mismatch at move 1, seed 2291 and path `0:0:0`,
with zero additional shrinks. Exactly one replay failed and 21 tests were
skipped; no fixed campaign ran. Byte restoration was checked against production
blob `85b58a7de32bc881179b2c85955f9f3773d27319` before the same replay passed.
Its repaired reach was one for both states. Replay skips normal reach budgets
by design. Logs: `review-2291/topk-numeric-partial-replay-red.log` and
`topk-numeric-partial-replay-green.log`.

## Rubric audit and limits

- ORC-001–005: the API and architecture authority, bounded grammar, independent
  rank predicate, real operator paths and observation cut are stated above.
- ORC-006: original production is rejected as a timeout/runtime failure and by
  the partial-width row assertion. The three mutants fail their intended
  demand/row comparisons, as recorded above.
- ORC-007: fixed/random campaigns share mechanics and budget. Registry key
  `ivm.topk-numeric-window` accepts seed/path; the checked replay fails against
  the rounded-width mutant and passes after exact source restoration.
- ORC-008–009: authored offset and width are independently observable after a
  partial move. Installed support and requested window remain separate concepts.
- ORC-010: shrinking preserves the first row/size/demand observation and move
  checkpoint. The graph owns no asynchronous resource in this driver; the RED
  watchdog kills the entire subprocess group. Heap failures remain separate.
- ORC-011: the named shared-overflow hypothesis is addressed by the rank
  predicate, which avoids production's offset-plus-width arithmetic. No further
  independent formulation was identified as needed for this bounded law.
- ORC-012–013: this record ties the law, source revision, neighboring witnesses,
  actual RED categories and GREEN reach to their observation boundary.
- ORC-014: this owner claims an operator boundary. The shared real-framework
  receiving grammar owns source growth and the cross-adapter handoff.
- ORC-015–016: each profile declares reach. Fixed examples and generated histories
  use the same model/driver/checker; no expected-answer example was added.

Limits: one payload per typed key, positive installed support, one group, finite
safe-integer authored numeric bounds, and settled graph cuts. This evidence does
not establish real provider completeness, asynchronous demand settlement,
multi-group reconfiguration, arbitrary negative/fractional window semantics, or
a general CPU bound. Those remain with their existing owners. Extra graph
messages are deliberately permitted; the demand law requires progress, not
minimal scheduling.
