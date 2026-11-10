# E7 v2 R03 partial result and quiet successor diagnosis

Reviewer: `/root/review_combined_held_cuts`.
Review date: 2026-10-30.

## Decision

Preserve R03 as a partial finite run stopped by a missing required reach.
The reach guard correctly reports that the quiet full-window recovery law was
not enforced for the aborted-cover history. This is a supported oracle
checkpoint/account gap, designated **R03-E7-QUIET01**. It is not a demonstrated
production mismatch or production RED. Four later selected R03 bodies and R04
remain unexecuted. No retry, source change, production change or later command
is authorized by this report.

The smallest justified repair belongs in the primary oracle's independent
publication account and its checkpoint instrumentation. Preserve the current
history and its required quiet reach. Track authored same-source replay
supersession separately from immutable own receipts, resolve each captured
publication hold to its terminal successor, and require that successor's real
successful certificate before the existing pre-rescue full comparison. Do not
mark a failed historical replay successful or count an obsolete response as
coverage. Exact successor source review and new runtime evidence are still
required; this report accepts a repair direction, not an unseen implementation.

## Exact immutable result

Packet: `r03-request-health-provenance-e07-v2`, under the initial-preload repair
evaluation directory. Packet SHA-256:
`925b742c936cb2ddaf295fb24474500b537bff100461aa95c835714875b59e0a`.
Input freeze SHA-256:
`13b15880e74ed125f58c38c80c693b0ad99edc41dc54bf57b4144014978dbf4d`.
Independent source review SHA-256:
`98c3b08188790c3796d2a8af0e553c2c7ee42034352b686dd6cdc34dc1509ba0`.

| Result artifact | SHA-256 |
| --- | --- |
| R03 result freeze, eight members | `a64fa7b549aca693f7b7733e3085abb3656a842486796352bc95bfc5beffb6bc` |
| R03 raw receipt | `c575a8769cd0747b802546407867568262dcb024d4739fd02605c953829792f7` |
| R03 post-return closeout | `b7b5ad52ad1716160d64731cdd6c98502ba6dfeb15c0e8c4a132e3280c7f67f8` |
| R03 payloads | `9eb0ef473878ea6ae2779c996f5f1a69ed164d5b13f8ad452a0198c3283d78bf` |
| R03 raw log and reporter copy, 980921 bytes each | `33de5e1b82af5149aab85d9292ec59e1e52061f58444fd3c42bfca34ae281311` |
| R03 ROOT admission | `6b31a230a25b1061b7208a553b02c752d7d29d796c1352f5e15930b37ef312c2` |

All eight result members, all 81 source packet members, all 1415 current inputs
and recorded HEAD independently match. Prior R01 result freeze
`4e92e36ab2959d3386afa759e2fd468bdbd03f7279896a36a2198abd51a7ed07`
and R02 result freeze
`52accf27b417c4db80d4ca2dd04de630ea5f4cd8ee84180f6cdca5c7259a6a5a`
and their seven members each are unchanged. Their finite GREEN classifications
remain bounded by their separate ROOT records; R03 does not invalidate or
broaden them.

R03 had one process invocation, with worker 1, bail 1, a 120-second bound and
no Oracle environment override. Vitest exited 1; the launcher's rejected-result
return is 2. The raw receipt has no primary or secondary exception. Its
`lockReleased: false` describes the required receipt-commit checkpoint while
the guard was still held, and is preserved. The post-return closeout records
release after durable artifacts. Independent zero-signal probes find PID and
initial process group 15004 absent; the guard is absent and batch STOP is
present. No R04 run files exist. A process-table query was unavailable in the
review sandbox; the successful zero-signal absence probes supplied the fresh
process observation instead.

The raw reporter summary is exactly `1 failed | 13 passed | 114 skipped (132)`.
There are 128 verbose status entries: 13 passed, one failed and 114 skipped.
The remaining four selected bodies have no status entry because bail stopped
their execution. They are:

- sibling work holds an applied covering response;
- immediately admitted refinement fails;
- successful replay then admitted refinement fails;
- changed source publishes before admitted refinement fails.

All 14 payloads are exactly reconstructible from the raw log, with contiguous
observation sequences. Seven lifecycle and six publication histories completed
and reached every state they required. The seventh publication history,
`aborted old acquisition cannot cover the new replay`, is incomplete, with
238 observations. Its reach counts are:

| Required state | Count |
| --- | ---: |
| rejected-before-window-admission | 1 |
| aborted-covering-keeps-publication | 1 |
| recovered-old-window-at-quiet | 0 |

The sole Vitest failure is `createOracleReach.assertReached` at primary source
line 6351, reporting the last state. The launcher's inventory, pass-count,
payload-count and metadata violations are the expected consequences of this
first-surprise partial run, not independent evidence of four other product
defects or a selector failure. R03 selected and entered the failed body; the
four later bodies are unmeasured.

## Observed trace before any classification ledger

The following sequence numbers refer to the failed payload, not a combined log
clock. The original settled window is offset 0 / limit 1. The requested window
is offset 1 / limit 2.

| Sequence | Frozen observation |
| --- | --- |
| 105 | Independent own receipt freezes Error 34 for marker load 30, keys 3/4. Current publication account is markers raisedAt 10, with that failed load and no pending load. Public root scalars still show row 2. |
| 109–111 | Held covering load 35 is issued with keys 2/3/4/5, exact replacement edges are observed, and Error 34 remains the preceding immutable receipt. It has not applied. |
| 112–116 | The native waiter rejects with Error 34; the callback retains row 2 and the old window. The shared identity comparison sees only eligible Error 34. |
| 118–130 | Authored `supersedeCoveringReplay` performs a new marker truncate. Old acquisitions, including failed 30 and held union 35, abort. Current loads 42/44/46/48/50/52 are issued for the successor replay. |
| 133–134 | Obsolete union 35 settles ok with `aborted: true`. The current markers account is raisedAt 16, with all six current loads still pending and no failure. The obsolete response releases none of that current work. |
| 137 | `aborted-covering-keeps-publication` compares successfully: row 2 and the old window remain public while current union 50 is held. |
| 139–162 | Current loads 42 through 52 apply and settle ok without abort. The account empties only after the last current load; observation 162 records no remaining publication account. |
| 163–164 | New marker own episodes freeze successful receipts. These are new episodes; they do not revise the old Error 34 receipt. |
| 165 | Root scalar publication changes to row 1 with the same old settled window. |
| 166 onward | Subsequent demand retirement and the final rescue truncate/replay begin. No `rejected-wait-quiet-publication-compared` observation appears before them. |

Observation 165 contains only root `id` and `rank`; it does not observe the
include facade or prove complete nested coherence. The scalar progress checker
runs from the subscriber and reports no scalar violation. The full quiet
selected-value comparison was skipped, so this run supplies no full include
recovery judgment at the required pre-rescue checkpoint. Later rescue checks
cannot fill that gap retrospectively.

## Why the quiet predicate cannot recognize this recovery

In the frozen primary source, `raiseBarrier` first tries to lower settled
current accounts, then creates and installs a new account with
`barriers.set(source, barrier)` (lines 1155–1181). At the new truncate, the
original markers account 10 still contains failed load 30. It therefore cannot
be lowered as successful before account 16 replaces it.

`lowerSettledBarriers` iterates only the currently installed `barriers` map
(lines 1183–1191). It adds a current account to `completedBarriers` only when its
pending and failure sets are empty. After replacement, it can certify account
16, but has no path that later adds original failed account 10. Retirement and
settlement also act on the current source account. This is appropriate for the
original failure's historical identity; the old account must not be relabeled
as a successful replay.

The quiet `recoveredRejectedWait` predicate nevertheless requires every
original waited account, plus accounts raised since capture, to be a member
of `completedBarriers` (lines 4537–4547). Original account 10 remains in that
candidate list. Even with no current barriers and a successful source
successor, the predicate is permanently false. The full quiet `checkWindow`
and its reach at lines 4549–4564 never execute. The later generic settled-window
branch also uses `recoveredRejectedWait` as its applicable successful-recovery
condition; the already failed move rules out `remainingWorkSucceeded`.

The rejection callback has the same original-account membership test at
lines 4377–4380. This is a neighboring gap when a successor finishes before the
rejection observation, although the present trace rejects before supersession
and does not reach that arrangement. It should use the same independently
specified publication-successor rule where that rule applies, while retaining
the callback's additional graph-publication premise.

This source explanation distinguishes an unscheduled recovery from an
unrecognized one. The history already starts a newer authoritative same-source
replay, settles all its live work, reaches an empty account and observes changed
root scalars before rescue. Adding another drain or removing the quiet reach
would avoid the diagnosed condition instead of repairing its representation.

## Authority and repair location

The glossary defines truncate replay as an authoritative source replacement
inside the current sync run. Architecture law 9 and `Replay participants and
failure` require a failed replacement to retain the prior public snapshot until
an authoritative replacement succeeds. A newer truncate aborts prior
acquisitions, and their late outcomes decide nothing. The atomic-window law
keeps a failed move's settled window unchanged and keeps its own error distinct
from later publication recovery. The accepted R03 plan likewise separates
immutable own completion from publication lifetime.

The failed historical receipt and the current source replacement therefore
have distinct identities and obligations. A later successful replay can
discharge the source publication hold without turning the old replay or failed
window operation into success. Requiring the original failed account's own
success is not a contract premise.

The adversarial-review repair-location table places this finding in evaluation:
checkpoint/account representation and comparison enforcement. Production has
not been shown to disagree with the law. The reach guard correctly stopped an
unenforced full comparison. The previously accepted source/static review did
not challenge this historical-account identity premise, and E6's earlier bail
prevented entry into this aborted-cover history. Those are coverage and review
gaps; preservation of old code does not discharge this reachable obligation.

## Conditions for a narrow correction

Keep the existing aborted-cover history and all its required states. A compact
independent account can record each authored same-source supersession edge when
`raiseBarrier` replaces a current account, then resolve each captured publication
hold through that chain. A terminal successor earns a successful certificate
only from its own current non-aborted obligations and applied settlement. The
original account and Error 34 receipt remain immutable. Obsolete union 35
provides no certificate or installed coverage.

At the unchanged drained/flushed pre-rescue checkpoint, all captured source
holds must have terminal successful successors, with no remaining current
publication hold. Then the full shared `checkWindow` must compare the old
settled window, including include/facade values, against the independent model,
and record `recovered-old-window-at-quiet` only after that check succeeds.
A fresh change callback must not be mandatory at quiet when the correct public
replacement is observationally unchanged. Preserve the existing stricter
intermediate publication-progress conditions at the rejection observation.

Apply one independent successor rule consistently to the two corresponding
recovery predicates. Do not change the own-verdict chooser, replacement
coverage rule, public expected rows, required-state list, original budgets or
production source to make this result pass. Do not use current production
replay internals or output equality to invent the expected successor relation.

The primary grammar/shared comparison should distinguish no supersession,
one or repeated same-source supersessions, another source succeeding, and a
terminal successor still held, failed or successfully applied. An old aborted
response that succeeds, fails or never settles must not discharge a held
successor. Preserve a changed old-window result so stranded retention is
distinguishable; an unchanged-result lane checks that a needless callback
premise is not added. Existing shared publication controls should still reject
wrong or stranded full snapshots at the intended checkpoint. Calibration of
the successor-account rule and the actual receiving history are both needed;
a pure rule control alone proves no production path.

These are bounded repair conditions. The exact patch, successful reach,
calibration rejection and later command admission remain future evidence.
No production RED, universal replay closure, intermediate nested coherence,
natural covering-union choice or R04 outcome is established here.
