# H02 conditional progress law and pre-edit gate plan v1

Status: proposal only. No production repair, new oracle, contract change, commit,
publishing, or current-code execution is authorized by this artifact. Historical
H02 stays unverified/excluded. The frozen diagnostic packet remains unchanged.

## The choice the maintainer would actually accept

Proposed **conditional asynchronous progress law**:

> Process a legal finite external source step over a finite relation and finite
> cache identities. If an active asynchronous provider request already has its
> completion queued in the host scheduler, internal demand/cache ownership
> feedback must return control to that scheduler so the completion can execute.
> Returning control does not establish coverage or permit a partial replacement
> to publish. After the finite successful provider answers establish a stable
> source result and all applicable graph work settles, normal exact-result,
> ownership, and retained-publication laws apply.

This requires a waiting cut, not an immediately stable Boolean solution for
contradictory cached answers. It does not promise a number of D2 passes,
acquisitions, milliseconds, or requests. Diagnostic128 is a containment limit,
never a product work budget. It also does not require asynchronous deferral of
literal-true synchronous loads.

The important choice is whether this conditional progress promise is accepted
as an implication of the existing asynchronous APIs and stated explicitly, or
whether the product intends to exclude this otherwise legal composition. The
latter would need a documented restriction on custom cache identities or
anti-join/include compositions; current contracts specify neither restriction.
No existing docs authorize rejecting this fixture solely because two cache
entries temporarily disagree.

Do not bundle a decision about **permanently** incompatible cached answers into
this bug class. Infinite freshness, failed refetch preserving stale data, or a
provider that never completes may leave this nonmonotone composition without a
stable relation. Whether to retain a particular lease, prefer a version, report
a cycle, or require another source/key policy is a separate contract decision.
The proposed class includes a finite already queued answer that can resolve the
disagreement. A fix must let it run without silently choosing a new stale-cache
policy. Keep permanent-disagreement histories as separately classified design
challenges, not weakened expectations or claimed fixed cases.

## Nearest authority and the remaining gap

| Authority | Existing promise | What it does not establish |
|---|---|---|
| `packages/db/src/types.ts:384–408` (`LoadSubsetFn`, `SyncAppliedReceipt`) | Async subset success waits for establishing applied receipts; accepted commits become visible in order. | No explicit scheduler fairness theorem for nonmonotone feedback. |
| `packages/db/src/query/live/ARCHITECTURE.md:1556–1588`, law10 | Initial preload/readiness completes when currently reachable demands settle and eager sources are ready; load completion represents visible rows. | It does not make an unanswered provider complete or specify cycle policy. |
| Public `Collection.preload`, `stateWhenReady`, `toArrayWhenReady` API comments (`packages/db/src/collection/index.ts:694–701`, `1117–1143`) | Preload starts sync; readiness reads resolve at initial-query readiness. | A Promise type alone is not an unconditional termination guarantee. |
| Public `Collection.reload` comment (`index.ts:1292–1310`) | Reload completes on replacement application or new-run readiness while preserving visible state until the specified boundary. | It does not grant an early success when replay still has work. |
| Query Collection public refetch docs (`docs/collections/query-collection.md:602–618`) | Outside mutation phases, accepted results from refetch are applied before the call resolves, including no-diff results. | Refetch is an adjacent authority, not identical to `markers.reload()` in H02. |
| Architecture coherent publication (`ARCHITECTURE.md:1665–1683`) | Drain currently available synchronous work and publish a fully composed result. | It does not say how to suspend a demand/source feedback loop with no fixed point before async completion. |

Together these APIs need the host to execute legal async answers; a graph turn
that prevents an already queued answer from running defeats their supported
use. That is a strong compatibility argument for the conditional law, not an
explicit existing numeric bound. **Pre-edit gate:** record maintainer acceptance
of this exact limited implication if independent authority review cannot derive
it from the existing contracts. Do not silently edit the architecture to declare
one scheduling mechanism mandatory. Once accepted, document the waiting-cut
obligation beside demand side effects/coherent publication and add its oracle
owner. This is law articulation, not authorization to redesign cached ownership.

The following remain hard constraints:

- Cached ownership: a reacquired observer lease owns its latest successful
  cached rows while stale refetch is pending; failure retains them
  (`ownership-lifecycle.oracle.test.ts:961–975`).
- Atomic publication: join/include reads of one source share a replay barrier;
  incomplete replacements stay private (`ARCHITECTURE.md:1531–1542`, law9).
- Literal-true initial behavior: an initial ordered chain answered entirely by
  literal `true` drains and exposes its complete rows/readiness before its
  initiating stack returns (`ARCHITECTURE.md:1629–1648`). Ordinary synchronous
  source changes retain their existing cut (`1415–1425`).
- Acquisition success still means authoritative applied settlement, and
  canceled/obsolete demand cannot settle current work (laws6/7). A retry cap
  that pretends success is invalid.

## One runtime mechanism sample, with its partial receipt

E12 adds one primitive Error.stack sample at repeated acquisition14 to the
existing no-spy/no-retained-options historical reconstruction. It ran once.
`E12-stack-sample.log` records128events and the external-cap sentinel. At event68
the stack includes this single graph-drain chain:

`loadSubset -> startSubsetDemand -> requestSnapshot -> startSegment ->
setDemand -> CollectionSubscriber.setDemand -> compiler parent-key tap ->
TapOperator.run -> D2.run:71 -> maybeRunGraph:860 -> Scheduler.flush ->
Query result application`.

The captured40frames contain one D2.run frame. Combined with the builder's
explicit reentry guard and D2's pass loop, this supports feedback within one
fixed-point drain. It does not support a recursive stack-overflow claim, prove
all possible stacks, or identify the raw OOM's allocation owner.

Containment receipt is deliberately partial: the event-cap kill block and
leader `wait()` completed, then a redundant post-exit group kill raised EPERM
at runner line32 before the final JSON was written. The exact traceback is
preserved in `E12-partial-receipt-v1.json`. A subsequent process scan found no
scratch command matches. Maximum RSS, elapsed runtime, PGID and child exit code
were not preserved and are not reconstructed. No rerun was done. This sample
supplies stack attribution only, with no comparison, closure, or current-code
credit. Slot3 is released.

## Source gates: historical and relevant current code are distinct

Historical witness: archive `3937a73aeb3a273c95ab77b8d8dd66fc739517c5`, explicit
source aliases and cloned modern dependencies as frozen in the parent packet.
Original historical built bytes remain unavailable. Do not relabel these as
current S004 failures.

Root selected the current standalone replay source:

- Author tree: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`.
- Current pinned main base: `9cfa11fc712866f8f276e85762865ebb8bd49cbe`.
- Accepted dirty production identity: `d7fa2b44615b883fcc3da8971c45da8848e1a6921e4ff2e7f2c2983eec6f3ae0`.
- Complete candidate patch SHA256: `d2da68a7310a91445497792eee3df29737bea7ff6b3c8a3d9261ab01ecb07760`.
- Source envelope: `docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/latest-main-standalone-v1/`
  in the coordinator, especially `handoff-freeze-v1.json`,
  `composition-source-identity.json`, `candidate-freeze-v1.json`, and the complete
  `candidate-latest-main-v1.patch`.

The eventual pre-edit witness must run in newly isolated exact compositions:
(1) pinned current main, (2) that accepted replay source, and (3) the final
combined C only after its source envelope freezes, if integration affects this
path. Do not mutate, build, or run the completed author's worktree. Freeze
production/imported test/dependency/config/build identities, aliases and exact
commands for each. If main or accepted source changes before execution, obtain
the new root-selected immutable identity and repeat the relevant gate.

No such current run happened here. If current code already progresses, retain
the historical diagnostic and test the new witness without a redundant product
repair. If current main fails but accepted replay succeeds, investigate whether
S004 already repairs the law and validate that fix/mutant instead of claiming a
new unresolved S004 defect. A current failure remains a prerequisite to any
new current production change.

## Smallest composed generated history

Begin with the already observed five-row history, then shrink through the same
model/driver/checker. The smallest proposed seed is three ordered root rows A,
B,C, initial markers A,C, offset1/width1. The initial window is empty; warmup
must actually reach a retained nonempty include cache for C before claiming the
premise. Three rows are a proposal, not an executed result. A four-row dimension
with two initially unmatched rows should preserve a nonempty prior window;
that makes retained-publication comparisons materially stronger than an empty
baseline. Keep the existing five-row trace as a shared replay input.

Grammar phases:

1. Start the finite on-demand provider and live query with one stable
   subscription-based key builder; complete initial requests and observe initial
   readiness. Provider replies are complete exact predicate results.
2. Retain the historical include cache value containing pivot C. Move backend
   state to remove C and invoke the public reload. Keep cache versions distinct
   from current backend state; do not rewrite cache expectations from production.
3. Hold new replies. Deliver the join's earlier prefix, then its C scope empty,
   while the include cache for C is still nonempty. The new include refetch gets
   an already queued completion that returns the current empty C result.
4. Observe a scheduler cut and complete the remaining finite provider replies.
   Then compare public semantic values and exact surviving ownership.
5. Retire the reader and complete cleanup; verify no surviving lease owns rows.

Generate one dimension at a time around that premise: initial unmatched-row
count, pivot/rank position, offset0/1, width0/1/2, compatible versus separated
cache identities, cached empty/nonempty values, finite freshness, join/include
answer order, and timer versus microtask completion. Zero-width/no-include and
no-window histories are controls. Failure and infinite-freshness cases keep
cached ownership and require separate permanent-disagreement policy review
before a whole-class closure claim includes them.

## Independent judgment and observations

Use one finite mathematical relation computation: join root R against the
currently supported marker relation M, retain unmatched roots, sort by specified
rank/key tie-break, apply offset/limit, and attach marker rows for each selected
root from M. This predicts exact public values at settled cuts. Do not model D2
passes, demand-controller states, retries, or scheduling queues.

Reuse the existing ownership model's relation from opaque lease atoms to each
lease's latest successful row set. Cache result versions and backend rows are
separate inputs. Acquiring a lease from a generated cache result adds ownership;
a successful fresh answer replaces it; release removes only that lease. The
union of live lease results predicts source rows. Any receiving-driver mapping
from public subscription identities to model atoms must be explicit and stable;
it must not reuse production route classifiers to calculate expected results.
Automatic acquisition receipts may instrument a boundary law, but must not make
a missing expected demand invisible. Expected demanded pivot/coverage and final
row values come independently from the generated relation/answer history.

Reaches must be separate and measured across generated histories:

- Actual cached nonempty include result and newer empty join result for the
  same pivot coexist, with stable distinct custom-key identities.
- The include genuinely reacquires that cached result while its fresh provider
  answer remains pending; fetch count alone cannot establish this.
- A provider completion is already queued before repeated internal ownership
  transitions; its execution is an observation, not inferred from scheduling it.
- A nonempty retained prior public result is observed during the open replay,
  and a final settled relation is observed after successful provider completion.

The liveness receiver needs an external supervisor because JS timers cannot
interrupt a synchronous D2 drain. Send primitive phase/owner/cache snapshots;
never serialize subscriptions. Improve the runner's receipt reliability by
persisting spawn identity and last resource sample before entering the monitor,
and writing outcome in `finally`, including failed cleanup attempts. Preserve
independent process-group checks. Containment/time limits are operational test
limits with explicit finite-evidence claims, not product timing policies.

Classify results separately: setup/import failure; progress watchdog before the
queued completion; completion reached but a public semantic/retention comparison
failed; all required checkpoints GREEN; or resource termination before a useful
progress judgment. A watchdog failure is a bounded non-completion witness for
the stated progress property, never a successful row comparison or a retained-
publication mismatch. OOM alone is insufficient attribution. The pre-edit
progress RED must identify the same declared reached premise and queued answer,
not just any timeout. Never grant H02's old intended retention comparison credit
for a new progress failure.

After progress, use public reads, change payloads and a downstream reader at
stable documented cuts. While replacement work is outstanding, use the shared
retained-publication comparison against the pre-reload model snapshot; after all
successful replies apply, compare the entire result (order, values, include
fields), readiness/health and ownership. For the original five-row input the
settled model gives root3 with an empty include after marker3 is removed, but
the executable checker must derive this from relations rather than hardcode it.

## Unchanged controls and RED/mutant gate

Before production changes, the composed owner must show a generated reached
premise and progress RED against the relevant unchanged current receiving code.
Keep the historical witness separately attributed. Review the oracle before
using it as a repair instrument.

Preserve and rerun the cached-reacquisition owner (fresh/stale, success/failure,
peer ownership and delayed release), replay publication owner, include temporal
owner and relevant ordered-demand owner. Add generated controls in the composed
receiver for an all-literal-true initial chain with compatible answers and a finite
stable completed window, and for an ordinary synchronous source mutation outside
a replay or ordered-repair barrier: their promised rows/readiness must remain
observable before the initiating stack returns. A blanket async yield must fail those controls. A repair that discards
cached rows must fail ownership. A repair that publishes a partial window while
yielding must fail retained publication. A repair that suppresses needed demand
must fail the final independent relation or coverage observation.

After an authorized repair, run the same histories GREEN. Restore the original
relevant current production behavior as a hostile mutant; require it to fail the
progress property at the declared premise, not merely crash elsewhere. Add the
three wrong-repair controls above to challenge the law interaction. Keep exact
RED/GREEN/mutant receipts and all remaining limits. A finite current control that
never reaches cache disagreement cannot validate this composition. A surviving
in-scope counterexample keeps the declared class open.

This plan ends at the authority/current-witness gate. No production scheduling
mechanism, new ownership policy or permanent-conflict resolution is selected.
