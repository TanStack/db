# Convex lazy paging: receipt interleavings and composed publication

This follow-up strengthens the four open products from the prior
[loss-audit/strengthening record](2026-10-27-convex-lazy-paging.md).
The scientific models own authored facts, in-flight obligations, receipt debt,
coherent versions and permitted public snapshots. Provider ranges, cursor
encodings, page chains, sealing and transport callbacks remain driver facts.

Source binding: [manifest](2026-10-27-convex-lazy-interleavings-source.json).
The source began at branch commit `8c24922026fb4a714cb54b992ac85faa2e876742`
with the previous round's uncommitted implementation. No production fix was
needed in this round. All seven Convex production files match its recorded
pre-round hashes; core `collection/subscription.ts` was restored byte for byte
after calibration. Earlier records and frozen evidence remain historical.

## Laws and receiving boundaries

- **Exact applied settlement:** `LoadSubsetFn`, `LoadSubsetOptions.signal` and
  `SyncAppliedReceipt` in `packages/db/src/types.ts` require establishing
  receipts and permit an uncancelable in-flight baseline. The existing
  `LazyReceiptModel` now records that independently authored obligation with
  `initiate`/`finish`. Abort can precede acceptance of already initiated work.
  Cancellation cannot settle before that work concludes and its assigned
  receipts apply. Core can fulfill after abort once all required facts and
  receipts apply; native/controlled receivers also assert their cancellation
  outcome policy. Ordinary rejection has no new universal receipt-wait rule.
- **Coherent version publication:** after full lazy acquisition, each observed
  source base must be one offered authored relation. Its compatible revision
  frontier cannot move backward. Stuttering and skipped intermediate revisions
  remain legal. Source provenance is checked separately, so offering facts
  does not stand in for delivering them.
- **Replay authority:** architecture sections on replay participants/failure
  and normative laws 7/9 require each graph's participating uncancelable work
  to finish before a replacement publishes. Failed authoritative replacements
  stay private through ordinary writes until a successful authoritative retry.
- **Cleanup authority:** architecture law 14 and `CleanupFn` terminate old
  dependent graphs. Every later value/status event must preserve their terminal
  state; a fresh dependent can receive a restarted source.

Native Convex emits coherent keyed diffs during ordinary reactive repair. It
does not issue authoritative same-run truncate replacement. Native and core
receivers therefore compose the same relevant laws through distinct boundaries;
an incompatible external truncate wrapper is not introduced as native behavior.

## Generated reach and comparison

All families run fixed seed `20261027` and a fresh random campaign with separate
reach ledgers. Explicit `*_SEED`/`*_PATH` replays bypass campaign minima.

| Family | Histories per campaign | Observed distinguishing states |
| --- | ---: | --- |
| `CONVEX_LAZY_INTERLEAVING_ORACLE` | 60 | Acceptance before final response; partial application before another acceptance; abort with held receipt; later peer acceptance; uncancelable acceptance after abort; abort with only unfinished in-flight work. All six: 60 in each lane. |
| `CONVEX_LAZY_NATIVE_RECEIPT_ORACLE` | 45 | Shared held native receipt, cached zero debt, cached shallow caller behind deeper held peer, new-version revalidation, canceled and successful held callers. All six: 45 in each lane; both SDK shapes observed. |
| `CONVEX_LAZY_VERSION_ORACLE` | 50 | Fully acquired multi-revision source, two accepted held revisions, later/skipped revision delivery, both SDK shapes. See raw reach log for each count. |
| `CONVEX_LAZY_FAILURE_HISTORY_ORACLE` | 40 | Failure before acceptance, shared held batch, error after acceptance with surviving owner, accepted writes surviving retirement/error, held cleanup after recovery, fresh graph with old graphs terminal. All six: 40 in each lane. |
| `JOINT_REPLAY_ORACLE` | 35 | Overlap with held receipt, newest done while older remains pending, failed replacement plus ordinary writes, retiring peer/retry, held cleanup/restart. All five: 35 in each lane. |

Response and accepted-batch counts vary independently in the interleaving
receiver. A legal-action scheduler consumes authored delivery, acceptance,
application and cancellation actions. It has no production call budget.
Constructive prefixes preserve the distinguishing cuts; generated dimensions
vary cardinalities and legal suffix orders.

The native receipt receiver observes actual sync writes and actual core
application receipts. Each required row/version absent at acquisition has a
unique supplying batch in its stable episode; that causal witness can assign
one receipt to two callers. Cached unchanged facts acquire no invented edge.
A cached caller may complete early or wait behind unrelated held work; only
post-drain completion is required. New-version revalidation installs the
authored coherent SDK caches before acquisition while callbacks remain queued.
Merely changing an unobserved remote source is not a promise of fresh load data.

Version comparisons run on every source publication after full acquisition.
Terminal graph comparisons retain every value/status event after their cleanup
monitor is armed, plus explicit drained checkpoints. They preserve transient
violations even when later state becomes correct. Core replay compares every
public snapshot event and each drained action, with explicit newest-settled and
older-pending predicates before crediting that reach.

## Calibration and production status

Unchanged production passed the extended families. There is no production-bug
RED or repair claimed in this round. Initial failed test drafts exposed fixture
assumptions (Map iteration order, an uninstalled source revision, and an
overstrong ordinary-failure expectation), not product defects.

Hostile checks distinguish the following wrong behavior:

| Control | Evidence and classification |
| --- | --- |
| Borrow a peer's applied receipt / wait only the first receipt | Faulty controlled adapters fail the actual caller settlement comparison. |
| Settle canceled while an uncancelable baseline is still in flight | Faulty controlled adapter fails `settled before in-flight work finished`; shrinks and directly replays at seed `20261027`, path `0:0:0:0:0`. All earlier accepted receipts have applied at this cut. |
| Return startup's applied receipt for a native held commit | Faulty native receiver preserves actual core receipts for observation but lies to the adapter. It fails `a settled before receipt-2 applied`, shrinks/replays at seed `20261027`, path `0:0:0:0:0`. Correct receiver passes. |
| Transient rollback / mixed versions followed by correct final data | Recorder/model controls fail the version comparison after retaining the bad event; both shrink/replay at seed `20261027`, path `0:0:0:0:0:0:0`. These are not production-pager mutation results. |
| Publish when only newest replay finished | Core production mutant fails the exact public-row comparison during held-receipt release; older A still participates. Shrink/direct replay: seed `20261027`, path `0:0:0:0:0`. |
| Ordinary writes reopen failed replacement | Core production mutant exposes revision 5 after failure and fails the public-row comparison. Same shrink/direct replay coordinates. |
| Revive/change an old terminal graph | Scientific comparator controls reject the observations. Native event recorders are independently exercised in generated cleanup/restart histories. |

The former future-peer receipt edge injection was removed. Waiting longer
behind a peer is permitted; an invalid model attribution is not evidence that a
production waiting strategy violates the contract. A positive model calibration
also accepts fully applied fulfillment after abort, while negative cuts reject
unfinished in-flight work and unapplied receipts.

## Independent review and validation

Three fresh `oracle-review` passes reviewed receipts/interleavings, core replay,
and version/failure histories; the latter also compared Query/Electric receiving
boundaries. Review found two repaired issues: a promise wait that could hide a
stranded caller behind test timeout, and the old model's blanket post-abort
acceptance prohibition. Native post-drain outcomes now fail before any unbounded
result wait. A suggested core reach predicate was also made explicit. Final
rechecks report no unresolved supported findings in their bounded profiles.

Fresh final validation:

- Full Convex package: **100 tests / 16 files** pass.
- Core replay/transaction/lifecycle receiving suite: **459 tests / 6 files** pass.
- Convex and core TypeScript checks, changed-file ESLint and oracle lint pass.
  Oracle lint emits the known missing-local-`main` diagnostic, finds `origin/main`,
  and exits 0. `git diff --check` passes.
- Semantic hostile controls shrink and directly replay as described above;
  correct receivers and restored core production pass.

Raw commands, logs, mutation restoration hashes and source-bound reviews are
packaged in `outputs/convex-lazy-interleavings-evidence` in the task workspace.
The existing local installation workaround is unchanged:
`baseline-browser-mapping` 2.11.32 → 2.11.30, confined to the preexisting
uncommitted workspace/lockfile override. No install, commit or push was performed.

## Limits

These finite histories do not prove arbitrary nonquiescent temporal progress
or every TLA+ interleaving. The native causal receipt bridge covers unique new
facts and nonreentrant commits; idempotent/superseding attribution and cleanup
abandonment retain their separate controlled/receiving owners. Receipt batch
listeners fire when commit returns and do not impose FIFO listener order on
nested commits. Version histories keep source keys/order stable after full
acquisition; arbitrary partial-prefix retention and membership edits retain
their earlier owners. Core joint replay uses one source and two stable-key
filtered owners; joined/includes graphs and exact event-payload replica equality
retain existing coverage. Ordinary native errors may recover and are distinct
from core authoritative replacement failure. New concurrency monitors use
controlled SDKs; receiving them at a real backend remains open under the Convex
integration owner. Backend and React tests from the prior round were not rerun
or relabeled as fresh results here; production bytes are unchanged this round.
