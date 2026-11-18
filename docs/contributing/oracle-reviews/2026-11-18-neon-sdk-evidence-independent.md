# Independent Neon SDK transaction-evidence review

Review base: PR 2377 at `92a1493e0f45dbfd1fc3a51460ccb9228d8f787d`.
This record concerns upstream `@neon/realtime` 0.2.0 proposals. It does not
approve the separate TanStack adapter repairs. Node 24.19.0 and one Vitest
worker supplied the native runs; actual Chromium supplied the receiving runs.

## Narrow retained-proof proposal

**Verdict: approved within the stated boundary.** The reviewed patch is
[`2026-11-17-neon-sdk-retained-evidence.patch`](2026-11-17-neon-sdk-retained-evidence.patch),
SHA256 `b966c730ef65f3bc442398d9b7ca818c35f78feb7ac6e23fe224bc234347ba64`.
The exact sources, independent diagnostic instruments, results and log digests
are bound by the accompanying
[independent snapshot](2026-11-18-neon-sdk-evidence-independent-snapshot.json).
The installed SDK is unchanged. Comparing every copied `dist` file with the
installed package finds exactly one difference: `client/transaction-tracker.js`.
Its proposal SHA256 is
`59474afb3204aa86482a52b521ac231fedddfef8ede63ac092793f6a99efebfb`;
the installed file remains
`1b85e960b2d50602dea59bfdb887eb5143fa2f255561a26eb527e3eea166c899`.

The SDK's public `RawLiveQuerySubscription.awaitTxId` contract says it waits
until that subscription applied a transaction. Recently applied IDs remain
available for a mutation response that arrives later. Failure or close rejects
when it precedes application. The caller must supply an ID known to have
committed; the method does not prove backend commit. The shared eager oracle's
EVID-2 also permits a wait after failure to fulfill when the shown rows already
reflect its evidence. These authorities support keeping installed proof after
terminal failure and explicit unsubscribe.

The proposal first validates the ID and timeout, then checks retained proof,
then rejects a still-unproven wait when closed. It keeps the existing rejection
of all pending waiters, clears their timers, and makes repeated close retain the
first cause. `seen`, `applySnapshot` and `applyProgress` still ignore work after
close, so late input cannot manufacture new proof. The patch keeps the existing
1,000-entry recent-ID bound. It retains one merged MVCC proof, whose exclusions
are bounded by the retained snapshot representation, rather than a list of all
prior snapshots. The retained snapshot itself has no constant exclusion-count
bound in this patch. Holding a closed subscription therefore retains its final
bounded recent-ID cache and final snapshot representation until that object can
be collected.

“Unknown” means absent from recent IDs and outside the MVCC proof. A committed
ID below a snapshot's visibility boundary can legitimately succeed without an
explicit batch for that ID. An excluded ID or a future ID cannot. The proposal
preserves these distinctions rather than resolving every post-close wait.

Independent diagnostics execute the real public SDK over controlled v2 frames
and additionally challenge its tracker at the numeric boundaries. Fifteen
checks pass on both Node and Chromium:

- A known batch remains provable after terminal failure and after unsubscribe.
- Pending and subsequently registered unknown waits reject with the same close
  cause. Decimal normalization and invalid input/timeout rejection remain.
- A fresh subscription receives proof only through its actual SDK baseline
  MVCC processing; that proof remains after failure, while a future ID rejects.
- An MVCC proof with `xmin=10`, `xmax=20`, `xip=[15]` accepts 9, 14 and 19,
  rejects 15, 20 and 21, and cannot gain new proof after close.
- After 1,001 distinct IDs, ID 1 is evicted while 2 and 1,001 remain. Repeated
  close does not replace the original rejection cause.

The Node runner passes two tests, including a separate adjacent-trace recorder.
The Chromium runner passes one test containing the same fifteen checks and
trace recorder. The installed SDK's original public diagnostic independently
fails at the already-applied wait after terminal failure. Chromium against the
installed public SDK fails three public comparisons: retained batch proof after
failure, retained batch proof after unsubscribe, and retained baseline-only MVCC
proof after failure. Those are semantic comparison failures. The direct tracker
checks in that mixed Chromium diagnostic still target the isolated proposal;
they are not claimed as original-SDK RED evidence.

Commands from the worktree root are:

```sh
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-sdk-evidence.vitest.config.mts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-retained-evidence-independent.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-retained-evidence-independent-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
NEON_REVIEW_ORIGINAL=1 node node_modules/vitest/vitest.mjs run --config .review-2377/neon-retained-evidence-independent-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

The isolated diagnostic resolves SDK dependencies explicitly and uses the public
`dist/client.js` entry. Earlier missing-dependency, missing-export and browser
import/evaluation failures were setup failures; none counts as a comparison
result or a rejected mutant.

## Adjacent applied-proof gap

**Confirmed open at this phase.** Retaining proof already recorded before close
does not fix a close that interrupts the interval between row application and
proof recording. The public update-stream contract says every affected
materialized subscription has applied the update before a listener runs. The
SDK's reconciler prepares all targets, installs their successful states, then
invokes publication callbacks. `Subscription.publishBatch` currently notifies
raw update and materialized change listeners before recording the batch's IDs.
A listener can synchronously close the subscription or an already-applied peer
in that interval. The retained-proof patch then has no recorded proof to keep.

Independent public receiving comparisons on the unchanged narrow proposal
reject three cases on both Node and Chromium:

1. A raw listener receives a nonempty change carrying row value 2 and
   synchronously unsubscribes itself.
2. A materialized `onChange` listener observes the applied snapshot with value
   2 and unsubscribes itself.
3. In one multi-target publication, the first target's listener unsubscribes a
   materialized peer. That peer's retained public snapshot already has value 2.

In each case a wait registered before delivery and one registered after close
both reject, despite the applied result. A future ID rejects as required. These
are recorded public observations and semantic comparison failures, not timing
or setup failures.

Three neighboring comparisons already pass in both hosts: a throwing callback
preserves the applied rows and proof; a parser-refused target keeps its prior
rows and receives no proof while its healthy peer applies and gains proof; and
a publication held before commit exposes no update or new row, leaves its wait
pending, then rejects that wait on close. These distinguish moving proof to the
actual installation boundary from acknowledging a parsed or staged transaction.

The sources and pre-edit result files are
`.review-2377/neon-applied-proof-independent*`. The native and Chromium commands
are:

```sh
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-independent.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-independent-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Both exit 1 at the comparison, with exactly three failed observations and three
passing neighbors. These comparisons ran before the second isolated proposal's
source edit. The repair location is the upstream SDK's post-application proof
boundary. Moving the loop only to the start of `publishBatch` would still let an
earlier peer callback close a later target before that later method runs. The
proposed next experiment places proof after each target's successful snapshot
installation, before any application callback. The author is preparing that
separate proposal; this phase does not claim its GREEN result.

A proposed baseline-logger sibling was checked and rejected: the diagnostics
dispatcher queues public logger callbacks to a microtask, after same-stack
`publishReset` records MVCC proof. No baseline logger defect was established.

## Evidence limits

These finite public receiving histories and direct tracker boundary checks
supplement the shared eager oracle; they do not establish generated-history
closure. The provider is a controlled v2 WebSocket transport, not a deployed
Neon service. No installed dependency, upstream release or application source
was changed for this independent review. Unknown-ID safety assumes the public
committed-ID precondition. Reconnection, query renewal, database-history changes,
transaction-ID wraparound and unbounded retained history remain outside this
narrow verdict. Broad EVID-2 closure remains open while the confirmed callback
counterexamples remain.

## Additive applied-proof proposal

**Independent verdict: approved for the exercised receiving boundary.** This is
an append-only amendment to the preceding open finding. The separate upstream
[`2026-11-17-neon-sdk-applied-proof-order.patch`](2026-11-17-neon-sdk-applied-proof-order.patch)
has SHA256
`7a590e7ba6f3ebe92f0f150e130de4c1cf76dd64d69fd54d6dc9ce1abcb659e1`.
The isolated proposed `subscription.js` has SHA256
`79799cea5c43b469d159b6e8ad8e2ee929fe2d60355a7cfc3bc357743e920c50`.
The second SDK copy includes the preceding retained-proof patch unchanged and
otherwise differs from the installed SDK only in those two JavaScript files.
The narrow first proposal remains preserved separately.

The additive patch records each installed batch's transaction IDs immediately
after assigning the successful public snapshot in `prepare`'s installation
closure. It removes their later recording from `publishBatch`. The closed guard
still prevents installation after an earlier close, and failed preparation never
reaches this point. The reconciler installs all successful targets before
invoking publication callbacks. Resolving a Promise does not synchronously run
its user continuations, so recording proof during those installation closures
adds no intervening application callback. This accounts for the healthy peer,
refused target and cross-target close distinctions without changing MVCC input
or snapshot semantics.

The exact same six diagnostic comparisons then pass in Node and actual
Chromium. All three earlier failures now retain fulfilled pending and late
known-ID waits, including the materialized peer whose snapshot was installed
before the first target's callback. The callback-failure, parser-refusal and
uncommitted-publication neighbors remain GREEN. Every future-ID check still
rejects. Separate runs in both hosts pass all fifteen retained-proof boundary
checks. The earlier empty-batch reentrant trace also now fulfills both its
pending and late known-ID waits.

The production-driver module and its six comparisons were unchanged between
RED and GREEN. Instrument changes only select the isolated SDK copy and choose
separate result filenames. The original narrow proposal is the original-defect
mutant: the same comparisons reject its lost proof at the intended observation
cuts in both hosts. The additive proposal is not installed into workspace
dependencies and has not been published upstream.

The GREEN commands are:

```sh
NEON_REVIEW_APPLIED=1 node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-independent.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
NEON_REVIEW_APPLIED=1 node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-independent-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
NEON_REVIEW_APPLIED=1 node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-retention-independent.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
NEON_REVIEW_APPLIED=1 node node_modules/vitest/vitest.mjs run --config .review-2377/neon-applied-proof-retention-independent-browser.vitest.config.mts --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1
```

Each command passes its one test. The first two judge six public observations
per host; the latter two judge fifteen retention checks plus the original
reentrant trace. The appended snapshot phase retains all four commands, result
files, log digests and exact source hashes. No supported counterexample remains
in those six receiving histories and their stated checkpoints. This is a finite
SDK proposal review, not generated-history closure for the shared eager oracle,
a deployed-service result, or confirmation that the installed SDK is fixed.

**Law:** already-applied transaction proof survives a subsequent close;
unapplied or unproven IDs never gain success. Authority is the public SDK's
application/update ordering and `awaitTxId` contracts, with EVID-2 as the
receiving requirement.

**Reach:** three reentrant close paths and three distinguishing neighbors run
in Node and Chromium; the earlier fifteen proof/retention checks also run in
both. These counts are finite executions, not generated reach.

**RED:** unchanged narrow proposal rejects all three applied-before-close
comparisons in each host while the three neighbors pass, before the additive
source edit.

**GREEN:** the additive proposal passes the same six comparisons and all
retention controls in both hosts.

**Mutant:** the preceding proposal retains the original proof-order defect and
is rejected at those semantic comparisons. Setup failures are excluded.

**Limits:** controlled v2 frames, the six authored receiving histories, one
or two subscriptions, one nonempty publication, one parser refusal and the
retained-proof boundary checks. No universal or generated-history closure,
upstream release, database service, query renewal or arbitrary concurrent
publication claim follows.
