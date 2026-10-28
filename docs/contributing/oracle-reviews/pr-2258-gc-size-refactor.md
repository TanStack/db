# GC retention: production size refactor

This append-only record supplements the three GC retention reviews. It evaluates
an internal refactor of the published `baa7d7d730329fdbf1fab30cc25a0932abc757da`
implementation, after a normal merge of `origin/main` at
`45c33292b2c4f09a63f856a829c1e15ca2b470aa`. The evaluated sources are bound by
`sizeRefactor.sha256` in [the source record](pr-2258-gc-retention.sources.json).
The commit that first adds this record is the evaluated revision. Earlier source
bindings and experiments remain historical records.

## Preserved laws and smaller machinery

No oracle model, history grammar, expected result, run budget, or public contract
changes in this refactor. The original violated GC law and authority, original
production RED, and hostile controls remain in the earlier records. The size
request does not identify another product defect: the starting implementation
passes the focused behavioral checks but exceeds the requested shipped weight.

The governing laws remain persisting-transaction retention, renewal after the
last hold, absolute startup/preload handoff, exact last-unsubscribe delay,
pending-rollback deadline preservation, explicit-cleanup precedence, and no
restoration of discarded optimistic rows. The optimistic transaction owners
also require the same net mutation payload, original snapshots, metadata,
settlement outcome and public rows. Cleanup retains its three observation cuts
and ordered error diagnostics, including an error whose value is undefined.

The refactor removes duplicated control flow and temporary structures:

- Empty and nonempty transaction commits share completion and publication.
  Empty commits still complete synchronously without invoking the handler.
- Mutation merging dispatches on the incoming operation without allocating a
  composite operation string on supported paths. Insert/update and update/update
  share field and metadata merging while preserving their distinct envelopes.
  Applying mutations shares one insert-or-replace path.
- The GC timer has one renewal entry point. Settlement preserves remaining
  handoff time, while last unsubscribe clears it. Explicit cleanup reuses timer
  cancellation. Automatic cleanup already consumes its queue entry.
- Idle delivery calls cleanup directly after the same eligibility and budget
  checks. The cleanup promise owns reentrant callers, and sync cleanup selects
  exactly one synchronous or asynchronous finish path, so no additional finished
  flag is needed.
- The shared timeout executes due queue work directly, without a single-caller
  dispatch method or a second empty-queue guard.
- Size calculation counts directly instead of allocating filtered arrays.
  Collection iteration delegates to its existing entries iterator. Settled
  transaction pruning uses the existing sorted map's deferred-delete operation
  instead of a scratch list and a second pass.

Deferred deletion is essential. Ordinary deletion splices the sorted key array
while it is being iterated and skips the following transaction. The overlay loop
has no callback or ordered transaction-map read between deferred deletions.
Restoration of the ordered view therefore occurs at the next ordered read,
after the overlay is complete.

## Executed behavioral evidence

The final focused run passes **608 tests in 15 files**, with no type errors.
It includes GC retention, GC mutation admission, the two-Collection GC property,
checker calibration, cleanup/restart, transaction ownership, queue properties,
Collection and transaction examples, optimistic payload/composition, outcomes,
publication, and settlement boundaries. The GC properties retain all declared
reach minima and both their fixed and random campaigns.

Calibration deliberately replaces `transactions.delete(id, true)` with ordinary
`transactions.delete(id)`. The existing optimistic-outcome owner rejects it at
`rows visible when isPersisted settled`: a surviving peer disappears when its
preceding settled entry is removed. Eight finite histories and both generated
campaigns fail the intended comparison, for ten failures total. The fixed
campaign shrinks to seed `851203`, path `0:0:0:0:0:0`, with absent initial rows,
rollback, a non-optimistic first request and a surviving peer. This is an
assertion rejection, not a setup error or timeout. The ownership owner passes
its eight tests under that mutant and is not credited with this kill. The
source is restored byte-for-byte before the final 608-test GREEN run.

Native Chromium passes **3/3 histories** on the final source. Real
Electric/Postgres passes **12/12 paths** on the final built package, including
both sibling settlement orders and a genuine SQL-open survivor beyond the
first-release deadline. Each path reaches its declared provider-confirmation,
renewal and usable-idle cuts. The previous cross-host limits remain: these are
separate native-host and real-provider witnesses, not one combined schedule.
DB source/test TypeScript, private-member cache, focused ESLint, Prettier and
whitespace checks pass.

Commands and local logs are under `/private/tmp/pr-2258-size`. The full commands
for the unchanged receiving drivers remain in the round-three report. No new
oracle coverage or universal bug-class closure is claimed by this refactor.

## Shipped bytes

`pnpm size:compare --packages db --files` uses the normal minified production
build, compression settings and app scenarios. The whole PR compares against
merge-base `45c33292b` on `origin/main`, rather than against an older PR version.
Negative values mean fewer shipped bytes.

| Production output | gzip delta | Brotli delta |
| --- | ---: | ---: |
| DB bundle | -6 B | -69 B |
| Typical app | -18 B | -52 B |
| App with Effect | -8 B | -57 B |
| App with groupBy | -19 B | -69 B |
| App with includes | -14 B | +56 B |
| App with join | -20 B | -113 B |
| App with LocalStorage | -20 B | -103 B |
| App with optimistic action | -4 B | +50 B |
| App with paced mutations | +1 B | -25 B |

The DB bundle and typical app meet the net-negative target in both formats.
Compression is not monotonic: the small increases in three feature scenarios
are retained explicitly above. They prevent a claim that every application
bundle becomes smaller. No names, comments, formatting, compression settings,
scenario definitions or minifier options were changed to obtain these results.
An attempted removal of the cleanup outcome wrapper reduced raw source but
increased Brotli weight, so the existing wrapper and error handling remain.

Production source growth is separate from test/documentation weight. This
refactor adds no tests and changes no test expectations. Its documentation
records the size result and binds the final production sources; test and
contract growth for the broader PR remains in the earlier reports.

## Local install recovery

After the main merge, the registry returns HTTP 403 for
`baseline-browser-mapping@2.11.32`. Version `2.11.31` is absent from the registry;
`2.11.30` is the nearest earlier installable release. A local-only workspace
override and resulting lockfile changes remain uncommitted. The temporary main
baseline uses the identical override. Existing overrides are preserved. This
dependency is outside the changed production modules, and the workaround is
not included in the pull request.
