# Real receiving updates and generated metadata neighbors: source-only plan

This is a plan, not runtime admission or a new result. No production, oracle,
driver, source573 inventory, frozen preparation packet or raw run is changed.
The canonical survey cutoff remains unchanged. Source anchors below refer to
`codex-misfits-h02-metadata-receiving-v1` at detached commit
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`.

## Accepted law and current evidence

`VirtualRowProps`, `docs/guides/live-queries.md` (Virtual properties), and
`packages/db/src/query/live/ARCHITECTURE.md` (Coherent publication) require the
same complete public value at reads, callbacks and downstream observations.
A same-key update's `previousValue` describes the preceding public value,
including its four virtual fields. Structured projections receive their output
Collection's metadata under the existing maintainer decision. This plan revises
none of those laws, cache ownership, or the atomic window barrier.

The independent judgment is already in
`packages/db/tests/query/virtual-row-fields-publication-oracle.ts`:
`attributeMetadataRows`, `checkAttributedRows` and
`checkMetadataPublications`. Its before/after delta requires an update and its
complete `previousValue` when one key persists and its value changes. The H02
ordinary relational model supplies payloads independently of Query cache state.

The four-cell matrix in this directory remains authoritative: scope/default
and scope/authored are finite GREENs for row4/rank40 to row3/rank30, a
delete/insert transition. Subscription/default and subscription/authored are
strict bounded progress REDs; their nine terminal states remain UNREACHED.
None is a real receiving update or metadata production-mutant kill.

The maintainer requires progress so an already queued finite backend answer can
run while cached-row ownership and atomic publication remain intact. That is
authority for investigating the progress defect, not evidence for a candidate.

## Smallest history extension

Keep all four existing histories. Add an opt-in metadata follow-up after the
actual reload has settled and its existing `final-publication` has been
compared. At that point, author a source rank update for the surviving pivot,
then send one real source sync `update`. Do not replace receipts or synthesize
a change message.

For `keyShift = 0`, `rankScale = 10`, the sequence is:

1. Existing prior public result: row4/rank40.
2. Existing completed reload: row3/rank30.
3. New source update: row3/rank35; row3 remains the selected result.

The third step owes one actual same-key update at each receiving layer. Its
previous value is row3/rank30. A missing previous value, the new rank35 value,
or the old row4/rank40 reload baseline must fail the same shared comparison.
The first two steps remain separate observations and retain their current
checks. This avoids changing the established conflict trace to manufacture an
update during its currently failing progress phase.

Add a history coordinate such as `metadataFollowupQuarter?: 0 | 1 | 2 | 3`.
Absent preserves the original driver; positive values set the pivot's rank to
`(3 + quarter / 4) * rankScale`. Zero is a later no-op control. The pivot ID is
authored as `keyShift + 3`, not read from the production result. All positive
values remain strictly between the pivot's old rank and the next source rank.

**This rank interval is a relational fact, not a coverage certificate.** Rank
is an order term. Its update can invalidate established prefix authority and
start ordered repair even if the row remains in the same relative position.
Author the rank fact before writing it; serve any resulting real finite
provider requests; record their acquisitions and applied settlements; retain
the complete prior snapshot while an applicable barrier is open. Source
`commit()` or Query-cache quietness alone cannot prove that downstream repair
has published. The follow-up final cut must follow the actual complete graph
publication and any required applied settlement. If the receiving driver cannot
establish that cut faithfully, stop at a driver gap. Do not bypass repair or
assume synchronous completion. A nonordering payload field is an alternative
design, but would need an additional fully compared ordinary-model field and
is not part of this minimal plan.

## Exact source changes to prepare later

| Source and current anchor | Minimal proposed change |
| --- | --- |
| `packages/query-db-collection/tests/queued-answer-progress-oracle.ts:21` | Add the optional metadata follow-up coordinate to the receiving history; absent leaves all existing histories unchanged. |
| Same file, `modelProgressValue` at line 137 | Permit authored source-rank facts for the additional observation stage, then run the existing independent `modelOrderedReplayWindow` computation. Do not model the Query cache, infer facts from observed rows, or change existing prior/final answers. |
| Same file, `createProgressReceiptCheck` | Reuse its ordinary snapshot/event judgment for the explicit second transition, from the already checked reload result to the independently computed follow-up result. Reset event accumulation only at the observed `followup-start` boundary after the first final comparison. Keep ordered snapshots, occurrences, delete values, monotonic complete publications and all existing failure checks. The existing first-transition checker must still run unchanged for absent follow-up. |
| `packages/query-db-collection/tests/queued-answer-progress-driver.ts:63` and line 90 | Add a source control accepting an authored `{ id, rank }` and returning the actual sync applied receipt. Preserve the existing synchronous mutation control. |
| Same driver, after line 763 and before cleanup | After actual reload settlement and the compared final publication, emit `followup-start`; author the new rank, perform the source sync write, retain/capture its real receipt and any new repair activity, and record a distinct `followup-publication` at the complete receiving cut. Keep real root/downstream callback recorders and `captureChanges` (line 639), complete `entries()` observations, raw metadata and normal cleanup. Do not use a public window operation to force this transition. |
| `packages/query-db-collection/tests/queued-answer-metadata-oracle.ts:132` | Extend observation stages and batch accumulation for the explicit follow-up. Store each layer's independently checked reload-final expected rows and entry binding as the follow-up before-state. Compute follow-up ordinary rows through the same relational model and metadata through the same attribution judgment; compare snapshots and the full accumulated delta through `checkMetadataPublications`. |
| Same file, `expectRows` at line 153 | For the follow-up default lane, reuse the locked, checked reload-final public entry key for each ID. Do not rebind the follow-up's observed key as its own expectation. Authored keys stay independently predicted as `metadata-<layer>-<id>`. Downstream selected upstream metadata uses the locked root binding. |
| Same file, histories/states; `queued-answer-metadata-oracle.test.ts` | Register fixed replay inputs and generated per-path campaigns with the same native supervisor, ordinary checker and metadata comparison. Add structural reach only after actual comparisons, as specified below. |
| `docs/contributing/oracle-coverage.md`, virtual-row-fields owner | Record real receiving update reach and remaining limits only after actual evidence; until then keep this as a named gap with this plan as its witness requirement. |

The public default-key contract is the stream key; joins use parent source
keys, and custom `getKey` selects a separate reduction path
(`docs/guides/live-queries.md:107`, live `types.ts:87`). The proposed source
update preserves source ID, join inputs and the unmatched outer side.
Static source inspection supports this candidate: join output derives its key
from the two parent keys (`compiler/joins.ts:791`), and projection retains the
stream key (`compiler/select.ts:118`). This is not native reach evidence.
Require actual retained entry keys and actual `type: update` in both layers;
if default keys change, the same-key claim failed. Do not impose a new key
encoding, relabel delete/insert as update, or borrow authored-lane credit.

No change is required to the independent attribution/publication judgment or
the original supervisor for the base plan. Any additional supervisor receipt
recognition or provenance inventory changes must be reviewed and frozen in a
new successor packet; do not overwrite the already executed packets.

## Required reach and generated neighbors

Each cache/key lane retains its own original states. Add separately named
follow-up reaches for: checked reload-final baseline, follow-up start after
settlement, real source update/applied receipt, same public key retained at
root/downstream, actual update callback at root/downstream, required complete
`previousValue` compared at root/downstream, selected upstream metadata,
aggregate message comparison, final root/downstream snapshots and normal
worker cleanup. A state is reached after its semantic comparison, not on a
matching phase label alone. Count actual repair activity separately when it
occurs; no repair is required merely to satisfy a reach label.

The positive fixed witness above runs in scope/default, scope/authored,
subscription/default and subscription/authored. Retain the old four fixed
replacement histories as replay inputs through the same judgment. A no-op
follow-up checks that unchanged rows owe no invented update or repeated batch.

For the first generated extension, keep the current nonempty-prior,
include/window and microtask profile. Generate `keyShift` in 0..20,
`rankScale` in 1..20, and a positive quarter in 1..3 constructively. Register
each of the four cache/key paths separately so sampling cannot omit a lane;
all generated histories in that path require its actual same-key comparison.
Use independent per-path reach. This varies identity, order scale and update
distance without adding a new provider law or changing the existing conflict
premise. Retain the existing scope ablation, strict conflict witness and
no-op control as distinguishing neighbors.

Use fixed and unseeded campaigns at equal `oracleRuns(8)` /
`oraclePropertyOptions(8, property)` budgets per path, following the existing
progress owner. Record sampled seeds, shrink paths, complete histories and
direct replay. Registration/configuration, campaign segmentation and total
runtime admission belong to the coordinator; this plan edits none of them.
Existing budgets are not reduced or removed. The original per-child
containment/provenance/failure-classification gates remain in force.

## Oracle-first sequence and honest result gates

1. Prepare only grammar, driver observations, ordinary-stage wiring and reach.
   Review their independence and run pure controls against the shared checker.
   Missing/current/stale previous values, key churn, duplicate update messages,
   omitted downstream delivery and callback-read disagreement must reject;
   permitted callback batch partition and unchanged-row no-op must pass.
2. Freeze a new source/provenance packet and obtain separate receiving admission.
   On unchanged production, run scope controls first. A same-key GREEN there
   calibrates receiving coverage; it is **not** an invented metadata RED.
   A real metadata RED must reach the intended actual update comparison and
   fail there, with setup, provenance, resource and cleanup outcomes separated.
3. Preserve the two existing strict progress REDs. Re-run an admitted extended
   strict witness on unchanged production only under the existing bounded gate.
   If progress prevents the follow-up, classify it as progress RED and leave
   follow-up states UNREACHED. It provides no metadata previous-value verdict.
   Generated strict terminal metadata claims remain blocked until progress is
   repaired and the candidate's separate oracle-first/control gates pass.
4. After the independently admitted progress repair, require strict queued
   callback execution, original scope controls, ownership/publication neighbors,
   actual root/downstream terminal observations and normal cleanup. Then require
   fixed plus equal-budget generated follow-up campaigns GREEN in all four
   independently measured lanes. Neither scope success nor a final snapshot
   substitutes for strict or message reach.
5. Run actual native production mutants after that GREEN. Mutate the real
   Collection change-message construction to omit update `previousValue`, and
   separately to substitute the current row (or an older visible row) for it.
   Keep the driver, raw receipt capture and shared comparison unchanged. Each
   default/authored lane must receive a real same-key update and fail at the
   complete previous-value judgment, at root and downstream with targeted
   mutations where necessary. Record exact changed production lines and the
   observed failing cut; revert each mutant before the next run. A checker-only
   hostile observation, delete/insert success, timeout or unreached terminal
   callback is not a native receiving mutant kill. Reintroducing the original
   progress defect supplies the separate progress-mutant gate.

## Limits and candidate coordination

This first dimension observes a source update through an already established
real QueryClient graph; the payload change itself is not a QueryClient-fetched
marker update. The anti-join's included markers remain empty. Output projection
metadata stays remote, not pending, and has stable Collection identity. Thus
the full previous row is compared, but this does not establish transitions
between distinct optimistic/source metadata values. An update spanning the
held reload barrier, a second Query reload, source-owned projections, new
provider shapes, timer delivery, empty priors, failures, optimistic outcomes
and framework receiving paths remain with their existing owner/needed-witness
limits. No class-closure claim extends to those histories.

The H02 candidate owner confirmed no law conflict when the source update starts
after actual final reload publication/settlement and with no active public
window operation. That owner also identified the order-term repair constraint
recorded above. Candidate causal evidence, controls, source binding, scope
neighbors and strict reach remain independent gates. This plan cannot admit a
production change or discharge any of them.

Required guidance read for this plan: oracle-authoring, the complete live-query
architecture and glossary, oracle rubric, virtual-row-fields coverage account,
the primary owner's contract/timeline machinery, its shared attribution and
publication judgment, the Collection lifecycle grammar, and the current H02
ordinary model/receiving driver. No native collection, receiving, campaign,
mutant, installation, Git or worktree operation was executed for this plan.
