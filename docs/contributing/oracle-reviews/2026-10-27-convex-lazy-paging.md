# Convex lazy paging: scientific oracle strengthening — 2026-10-27

This follow-up implements the maintainer's direction that the oracle owns the
scientific model and pager details remain in its driver. It starts from the
local implementation recorded on October 26, at repository HEAD
`8c24922026fb4a714cb54b992ac85faa2e876742`. All changes remain local and
uncommitted. The [source manifest](2026-10-27-convex-lazy-paging-source.json)
binds the current working tree. The prior implementation record, TLA+ package
and loss audit remain historical and unchanged.

## Law

Authority: `LoadSubsetOptions.signal`, `LoadSubsetFn`, `SyncAppliedReceipt` and
`UnloadSubsetFn` in `packages/db/src/types.ts`, the approved fixed-query profile
in the [collection guide](../../collections/convex-collection.md), and ordered
publication in `packages/db/src/query/live/ARCHITECTURE.md`.

Success requires exact scoped coverage and every actual establishing receipt.
Receipt establishment is many-to-many: one batch may establish several attempts;
one attempt may owe zero, one or multiple batches. Already-visible row content
cannot discharge a newly accepted receipt. Abort removes permission for new work
but cannot withdraw accepted writes; uncancelable baseline writes become visible
before the canceled caller settles. An unaccepted cancellation may settle promptly.
Retirement does not retroactively forbid an already-started response. Retired
subscriptions have no row, readiness or error authority over their replacement.

The source model sees authored row/version facts, scopes, owners, acceptance,
application and caller outcomes. It imports no production parser, comparator,
page chain, cursor encoding, sealing phase or commit partition. The native driver
alone translates opaque provider ranges. The applied-base provenance comparison
excludes optimistic overlays. Historical delivered facts remain allowed while a
new revision is waiting for application; settled coverage separately requires
current authored facts.

## Reach and observations

All campaigns run 60 fixed and 60 random histories, with distinct seed/path
prefixes and enforced reach minima. New campaigns use fixed seed `20261027`:

- `CONVEX_LAZY_HISTORY_ORACLE`: one ownership/action history composes acquisition,
  retirement, abort, chosen callback delivery, source changes, real optimistic
  application holds, cleanup and restart. Its constructive prefix reaches
  wider-authorizer retirement/abort while a successor is pending, delivery after
  retirement, stale success/error fencing, accepted-held-receipt cleanup/restart,
  and a changed source after restart. A 1–32 action suffix explores legal orders.
  Source size is 16–24, page size 2–5, both directions and both SDK shapes.
  Every source publication is checked using its contemporaneous provider-fact
  evidence. Branch reaches are separate; other declared states reach all 60
  histories per campaign.
- `CONVEX_LAZY_SUFFIX_ORACLE`: three six-row profiles, page size two, both
  directions and generated text. Two profiles have identical first-delivery
  evidence and actual discovery trace but different hidden suffixes. A third
  places three rows in the leading tie. Pending discovery and final exact
  coverage are checked through production. All three reaches occur 60 times per
  campaign. Separate comparator controls accept retained and reacquired
  overshoot while rejecting a lost row; they do not claim native strategy choice.
- `CONVEX_LAZY_EXACT_RECEIPT_ORACLE`: an independent receipt model receives actual
  core commit receipts, with independently varied 1–3 provider-response groups
  and 2–3 establishing partitions, both partition orders, text and two abort
  choices per generated case. Actual held response gates affect completion.
  Shared attempts owe the same batches; a peer with applied coverage succeeds
  while another waits. A held idempotent batch proves that row equality cannot
  stand in for receipt application. Cached success, true with zero/one/multiple
  synchronous receipts, ordinary Promise rejection and synchronous throw are
  checked. Quiescent comparison rejects stranding. Each declared reach occurs
  in all 60 histories per campaign.

The existing native lifecycle campaign now records every source and dependent
row publication and status transition during stale injections at cleanup start,
held cleanup and after restart, together with source error observations. It
checks a fresh dependent's ordered result after restart while the old dependent
remains terminal. Its ten declared reaches occur in all 60 fixed/random histories.
The SDK cache receiver, local backend receiver and React public receiver retain
separate roles.

## RED and production repair

Before production edits, all seven production-source hashes were saved in
`work/lazy-strengthening/production-before.json`, with raw byte copies. The
extended ownership property failed on unchanged production:

```sh
cd packages/convex-db-collection
../../node_modules/.bin/vitest run tests/lazy-paging-history-oracle.property.test.ts \
  -t 'generates ownership' --coverage.enabled=false --typecheck.enabled=false
```

`native-red.log`: seed `20261027`, path `0:0:0`, smallest source size 16/page size
2, at `retired callback reported an error`. The retained error callback of a
retired/replaced page subscription reached the current pager's error path.

The only production edit in this strengthening round is `src/subscription.ts`:
unsubscribe revokes callback authority before invoking the SDK unsubscribe;
JavaScript success/error callbacks check that authority, and React watch callbacks
check it before reading a possibly throwing obsolete cache. The pager, public
API and scientific expectations did not change to make this witness pass.

Early paired-suffix, cancellation-classification and fresh-dependent failures
were driver/observation mistakes: descending tie IDs changed the supposed equal
prefix; a DOMException failed an Error realm check; Collection values were used
instead of the ordered live result. They are recorded in intermediate logs and
are not production RED evidence. Review also repaired inert response grouping,
content-inferred receipt application, an ambiguous replay prefix, and aborted
requests retaining work permission.

## GREEN and hostile controls

Fresh logs are packaged under `outputs/convex-lazy-paging-strengthening-evidence`.
They include package/runtime, core receiving owners, React, real local backend,
TypeScript, ESLint and oracle lint checks. `package-final.log` is the final full
package run (87 tests); the core receiving run passes 465 checks and the React
receiver passes four. Direct minified public-index bundling with package
dependencies external measures +142 gzip / +113 brotli bytes for this round
(+420 minified bytes); this is a same-method comparison against the saved
pre-strengthening source, not a replacement for the prior packaged-size record.
The full existing backend suite passes 20 tests, including both lazy SDK
receivers; the targeted lazy run also passes separately. The local backend uses cached build
`precompiled-2026-10-10-72ce13c` and both installed SDKs.

Seven existing production mutants were rerun, shrunk, directly replayed,
restored byte-for-byte and given repaired GREEN replays: eager startup,
unbounded split child, missing leading tie, skipped applied receipt, older
receipt clearing a newer receipt, stranded duplicate request, and quiescent
stall. New callback controls restore the original unfenced subscription and
separately remove only React's before-read guard. Both fail semantically and
have repaired GREEN direct replays. JSON results retain seed/path/exit/hash data.

Six faulty controlled adapters fail the independent receipt comparison:
borrowing a peer's receipts, awaiting only the first receipt, skipping provider
completion, equating visible facts with an applied idempotent receipt, promptly
rejecting an accepted-held canceled caller, and stranding a quiescent cached
caller. These are actual faulty adapters through real Collection controls, not
TLA+ negative controls credited as implementation execution.

Two independent reviewers used the repository oracle-review skill, one comparing
Electric/Query receiving practice. Their findings drove the repairs above.
Reviewed source bindings and later narrow re-review are retained with the new
evidence. No review claim is transferred silently across source edits.

## Limits

This strengthens the runtime oracle without claiming equivalence to all four
formal projections. Exact receipt-edge calibration uses a controlled core
adapter; native Convex exercises its actual batching separately. The controlled
receiver supplies all provider responses before establishing commits, so
arbitrary response/commit interleavings are not covered. Its fact domain is
stable within a history; native histories separately vary source revisions.

Generated native cleanup retires direct owners first. The constructive native
lifecycle witness covers a surviving terminal dependent and held cleanup, but
not every surviving-owner/receipt/replay/failure product. Core replay/failure
owners remain primary and were rerun. No test here invents a total-call cap or
uses pager sealing state as scientific progress. Finite responsive quiescent
stalls fail semantically; the continuously nonquiescent TLA+ lasso remains
analytical evidence, and the fixture's turn guard remains diagnostic.

The existing local-only `baseline-browser-mapping` override (2.11.32 → 2.11.30)
and lockfile are preserved unchanged and excluded from review/commit content.
No install, commit, push or PR mutation was performed in this round.
