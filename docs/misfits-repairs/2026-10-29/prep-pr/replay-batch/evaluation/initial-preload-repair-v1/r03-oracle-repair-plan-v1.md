# R03 oracle enforcement repair plan

Status: proposed, frozen before implementation. Root authorized an oracle-only
repair after independent classification of the exact registered counterexample.
No production or oracle source has changed for R03. This plan requires review
before implementation.

## Accepted law and diagnosed defect

ARCHITECTURE.md, Atomic window publication (1396–1403): a window move waiting on
a failed replay rejects with that replay's own earliest still-deciding Error.
Replay participants and failure (1526–1543) preserves Error object identity and
shared publication across subscriptions of one source. Law 17 (1930–1940)
scopes deciding failures to retained demand and replacement coverage. Historical
maintainer commit 0203c3f68 establishes the own-error rule. The #2231 section
“judge each subscription's replay verdict” makes failure depend on a
subscription's own participants; successful publication still waits for siblings.
These authorities establish no global failure precedence across own replays.

The frozen S02 packet d60dd1b4 and independent report a9e1a356 establish a
model/comparison defect, not a product RED. At rejection callback115 and
comparison entry116, replay o80 of subscription o22 has rejected with its sole
own Error o112, unchanged through the window. Earlier Error o111 belongs to
subscription o11's still-pending replay o76. Source Barrier o75 merges their
histories and falsely demands o111. No ownership change occurs between109 and116.
Later cross-subscription pruning131 does not explain this failure.

## Repair location and independent account

Keep the existing source Barrier as the shared publication/retention account.
Do not split its publication hold, weaken retention, suppress a comparison,
or change a product error-selection rule. Replace only its use as an own-replay
error-identity account.

Add a small independent own-replay verdict account inside the primary owner,
`load-subset-replay-refinement-oracle.test.ts`. Its identities are opaque
subscription references supplied by adapter request options, plus model-created
replay episodes. It receives adapter issue, settlement, abort/retirement,
coverage/replacement, source truncate/reload, and existing driver batch cuts.
It imports no production classifier, replay state, chosen Error, completion
Promise, or diagnostic private snapshot. Its expected errors come only from
the driver's injected fault objects and the accepted logical-demand laws.

Separate three concepts in its data and prose:

1. The source's shared publication Barrier.
2. Each subscription's current own-replay obligation: its logical demand,
   participants, failure order, and still-deciding coverage.
3. A completed own-replay verdict receipt, which is immutable for a waiting
   window even if later demand retirement/replacement changes the current hold.

The account distinguishes a pending own replay from an own replay eligible to
complete. An outstanding own participant prevents a failure verdict. Failure
of another subscription does not change this eligibility. Successful own work
does not lift shared publication while sibling work holds it. A failed own
verdict selects its earliest still-deciding failure at its deciding cut, then
retains that exact Error in its completed receipt. A new truncate/discard or
new own episode is a different receipt; it cannot rewrite the old receipt that
a window already waited on.

Define deciding cuts from the reference history and the adapter boundary:
an own demand/start batch has ended and all of its live participating loads
have settled or retired. Adapter invocation/return and existing truncate/commit
batch boundaries keep synchronous setup distinct from pending work. The model
does not impose a scheduler deadline or predict native Promise reaction order.
If the adapter boundary cannot independently determine a cut for a reachable
existing history, stop and report that ambiguity with its trace before changing
coverage or relaxing the comparison. Do not copy production's setup counters
or resolve the ambiguity from production's actual chosen error.

At the existing rejection callback, derive the allowed Error identities from
the independent completed receipts of own replays that the window waits on.
Cross-replay completion order is intentionally unrestricted by this law. A
pending sibling's earlier Error is not an allowed completed verdict. Do not
first choose a subscription by the actual returned Error and then filter its
failure list. An Error object can legitimately occur in more than one failure
or own replay: membership and receipt eligibility must be evaluated before
matching the observation. Preserve completed receipts across later mutations;
a live view of currently active failures is insufficient.

Keep source retention, request-error judgments, publication snapshots, status,
receiving assumptions, and all existing exclusion boundaries unchanged. Any
unexpected reachable disagreement remains open for diagnosis; age is no excuse.

## Legal histories and measured reach

Leave the existing failedReplayCase arbitrary, its weights/order, and all old
campaign budgets intact so the exact registered R03 seed/path remains usable.
Keep the existing named same-subscription two-failure history as input to the
shared model/driver/comparison. Add the exact R03 history as another replay input.

Add one identity-focused generated campaign in this same owner, reusing its
existing command grammar and driver. Proposed additive property:
`replay.own-replay-error-identity`, fixed and random campaigns at120 histories
each. This is an added budget, not a replacement for the existing600-run
failed-replay campaigns or any other budget. Extend only the existing static
property list and replay manifest with that route; preserve all365 old static
keys, computed dimensions, old manifest routes, and ordinary configuration.

Generate the following distinguishing topologies and their legal permutations:

- Two failures within one own replay; first/newest settlement orders and two
  distinct Error objects. The later still-deciding failure must be rejected.
- Two same-source subscriptions: earlier failure has another own participant
  pending while the other subscription completes and rejects the window. This
  includes the measured R03 A0-pending state at the existing callback.
- Both own replays can complete: each own verdict obeys its own failure order;
  the checker permits contract-allowed cross-replay selection without ordering
  the source globally.
- Retirement/replacement before a verdict removes the affected failure as the
  accepted law requires; retirement/replacement after a completed own verdict
  cannot substitute a different Error for a window already waiting on it.
- Source replay replacement/discard, retired last demand, covered failed keys,
  and a still-pending neighbor preserve their existing distinct outcomes.
- Shared Error identity across multiple loads/own receipts is legal and does
  not collapse ownership or make a pending replay eligible.

Declare reach through createOracleReach at the same rejection callback, not at
a final drain: same-own-two-deciding-failures; earlier-failed-own-still-pending;
two-own-completed-verdicts; pre-verdict-failure-retired-or-replaced;
completed-own-verdict-survives-later-demand-change; shared-error-multiple-owners.
Count generated histories for each, retain measured totals, and require at
least5 histories per dimension per campaign. If a proposed dimension is not
expressible/reachable, report the needed grammar witness rather than claiming
closure from a pinned example or reducing a minimum.

## Checker calibration and ordered evidence

Before changing the judgment, retain the original exact RED evidence and
classify it explicitly as rejection of a lawful cross-subscription observation.
The already frozen S01/S02 runs supply that result; do not rerun or relabel them
as a production defect. Write the old/new predictions for each distinguishing
topology alongside the independent verdict account before changing assertions.

Use generated legal reference histories and the same independent account and
comparison for calibration. Feed lawful own-completed outcomes and reject
hostile observations: source-global earlier Error from a pending own replay;
later still-deciding Error within one own replay; latest-query-error
substitution; and a different Error object with the same message. A shared
Error must remain accepted when at least one independently eligible receipt
owes it. These are observations supplied to the shared judgment, not independent
literal-answer unit tests or production-derived expected owners.

After implementation, request the bounded runtime gate: exact original R03
source coordinate; the old same-own two-failure control; focused new generated
campaigns and checker calibrations; full retained primary source campaign;
appropriate lint/type/format checks. Record a hostile wrong-identity judgment
or production-observation mutant that the same comparison kills, with all
budgets unchanged. No before-reset mutation is authorized. Integration owns
the subsequent exact source/own-minified and full-primary-first receiving gate.

Update the existing coverage-map owner with this corrected abstraction, measured
reach, calibration/mutant evidence, and limits. Do not create another product
law, another oracle owner, or a new receiving-path claim. Retain the R02 coverage
amendment and size artifacts paused and immutable until root resumes packaging.

## Handoff and completion boundary

Freeze an exact oracle-only patch, pre/post source snapshots and hashes, all
additive registry changes, unchanged old-key/budget accounting, and evidence.
Integration must apply this delta to its exact C2 preimages; it must not replace
whole registries with standalone copies. Production and its existing own build
stay byte-identical. Independent review must accept the model independence,
eligibility, completed-receipt lifetime, earliest-own sensitivity, generated
reach, and original-coordinate correction before declaring this defect closed.
No implementation, runtime, PR, or publication is implied by this plan's freeze.
