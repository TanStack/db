# Wider loading lifecycle: Formation section

## Frozen corpus and limits

This is a Formation section, not a code review, simplification ranking or new
architecture. It reconstructs supported additions, substitutions and surviving
layers. No tests or runtime experiments were run for this reading.

- Current artifact: `1cec4d7f4669d1708800937a48eda0de8e9edaf9` in the
  `codex/loadsubset-minimal-stack` worktree.
- Baseline: `68366ecaeef6c12a13402b558bd4a68d7519442f`, an ancestor, not a
  comparison against a newly fetched main. Units present there are marked
  inherited; their original invention date is outside this corpus.
- Scope under `packages/db/src`: collection/{subscription,sync,state,changes,
  lifecycle}.ts; query/live/{utils,collection-subscriber,
  collection-config-builder,subset-demand-controller}.ts; query/effect.ts;
  scheduler.ts; live-query-window-controller.ts; query/subset-dedupe.ts.
- Indexed 132 first-parent commits changing those paths between the two
  revisions. Opened selected transformation diffs and baseline/current source
  for the units below. The index is broader than the detailed reconstruction;
  this is not a claim to have audited every hunk or every path equally deeply.
- AGENTS.md and the full live-query ARCHITECTURE.md constrain interpretation.
  Commit subjects were discovery cues, not proof of a change's semantics.
  Historical pointers below are `commit:path` and named symbols/hunks.
- Excluded: remote issues/reviews, uncommitted abandoned spikes, earlier grammar
  conclusions, sibling readings, adapter internals, and upstream history before
  the baseline. The large `76cd6d8a` import does not expose the earlier formation
  history of everything imported there. No intent is inferred from a commit
  timestamp. Commit order dates repository appearances, not invention.

## Unit register

Stable IDs identify responsibilities or representations, not proposed modules.

| ID | Unit and supported source | Survival at frozen head |
| --- | --- | --- |
| F01 | Collection-wide load status and imperative operation membership: baseline `collection/sync.ts`, `pendingLoadSubsetPromises`, `beginLoadSubsetOperation`, `trackLoadSubsetOperationPromise` | Inherited and modified; still distinct sets/scopes. Current methods near663–807 retain operation failure and collect follow-up registrations. |
| F02 | Applied outcome/provenance extension: `0034409d`, added query/load-subset-options.ts and load-subset-outcome.ts plus propagation through sync, builder, effects and demand controller | Added in this interval, then removed/replaced at `76cd6d8a`; `ff3e57b3` removes remaining result-extent payload plumbing. Those deleted modules are not current simplification targets. |
| F03 | Predicate-subsumption and shared-abort reuse: pre-`76cd6d8a` query/subset-dedupe.ts versus that commit's full replacement hunk | Overwritten by exact canonical key sets/maps; cancelable calls no longer use that shared-lease algorithm. Current exact reuse survives. |
| F04 | Logical demand distinct from physical work: `d3f18042:collection/subscription.ts` adds starting/active/detached and cleanup/restart handlers | Present. `b9fa9698` replaces copied acquisition fields with one acquisition object owned by a demand. |
| F05 | Per-attempt replay collections: `cdb9ecdb:collection/subscription.ts` removes attempts and per-attempt pending sets | Removed representation; replaced by session pending memberships and setup count. Not all attempt identity disappeared. |
| F06 | Retained startup admission: `baa2163f:collection/subscription.ts` adds attempt pendingCount/setupComplete and links each pending membership to its attempt | Present. This directly qualifies F05: an old attempt may accept returning work while setup or another participant retains it, but a drained attempt cannot reopen. |
| F07 | Replay failure location: `7b9ea648:collection/subscription.ts` moves failures from attempts to the session and gates writes by current attempt and active demand | Session map survives; per-attempt maps do not. Historical work may still delay publication without retaining historical failure maps. |
| F08 | Public replay baseline: `d65f07c5:collection/subscription.ts` removes publicationState.publishedRows copies and diffs against the existing publishedRows | Reuse survives. Private replacement rows still exist; removing a duplicate baseline is not removal of the public/private distinction. |
| F09 | Predicate-owned replay pruning: `4c382d75:collection/subscription.ts` deletes pruneReleasedReplayRows and its release hook | Removed. Source writes own retention. The same diff adds stale-row reconciliation to snapshot requests, so the cut is not a pure deletion. |
| F10 | Ordered completion chain: `48e39985:query/live/utils.ts` tracks the whole recursive refinement promise; `d03177ac` substitutes separately registered requests | Recursive-suffix representation removed. Completion still covers the logical chain because the next participant registers before the previous one settles. |
| F11 | Ordered source evidence: `88fad51b` adds sourceBoundary/readOrderedSnapshot and uses confirmed-range counts for continuation; `5e61e9ca` deletes trackBiggestSentValue | Confirmed boundary and contribution-derived invalidation survive. A second cursor derived from all emitted rows does not. |
| F12 | Source-recovery versus window outcome: `e6c8da4f:collection-config-builder.ts` sequences a window after replay; `92b6c536` adds windowFailed alongside orderedLoadFailed | Both scopes survive. Source replay can finish while an earlier imperative window remains failed/private. |
| F13 | Consumer window lease versus reported window: baseline live-query-window-controller.ts coordinator; `f2c7af87` substitutes getLeaseResult for isLeaseSatisfied | Coordinator survives. A pending lease returns its promise before consulting the settled getWindow value. |
| F14 | Graph scheduling dependencies/completion: `832bf765:collection-config-builder.ts` removes sourceDependencies; `84d788c5:scheduler.ts` removes completed | One builder dependency set and pending job/dependency maps survive. The two cuts affect different layers, not one common field. |
| F15 | Callback/error machinery: `0041231b` shares callback iteration in collection changes and scheduler; `573ccf00` shares normalization; `886ecdba:scheduler.ts` derives failure from an optional record | Shared helpers/optional record survive. Callback sequencing and context-specific error delivery remain outside those helpers. |
| F16 | Effect cleanup residue: `5a6b966a:query/effect.ts` retains only failed callbacks; `b09f7765` snapshots iteration and re-adds a callback whose outer invocation fails after reentrant removal | Reduced cleanup set survives with the reentry correction. Not equivalent to an ordinary set-delete loop. |
| F17 | Lazy demand segmentation: baseline and current query/live/subset-demand-controller.ts, DemandState/DemandSegment/setDemand | Inherited key/segment/pending-state layer survives. Current code changes equality identity and cleanup-error handling; it was not introduced by the recent replay changes. |

## Direct relation register

These edges are supported by actual parent-to-commit hunks. Neighboring commits
on the first-parent chain do not establish a semantic dependency by themselves.

| Edge | Relation | Direct support / limit |
| --- | --- | --- |
| F02 extension → exact settlement | cut/overwrite | `76cd6d8a` deletes the outcome/options modules and replaces their users; `ff3e57b3` removes remaining outcome type/return plumbing. Earlier development inside the large import is not reconstructed. |
| F03 broad reuse → exact reuse | substitute | `76cd6d8a` deletes the predicate-subset/lease code and installs completed/inflight canonical-key collections in the same file. No claim that all subset algebra elsewhere was removed. |
| F04 field copying → acquisition object | substitute/reuse | `b9fa9698` replaces copying options/session/abort fields in startup, replacement and release with an acquisition reference. Logical demand remains the containing owner. |
| F05 → F06 | cut then corrective addition | `baa2163f` directly edits the flattened representation introduced by `cdb9ecdb`, restoring bounded attempt provenance, not the old set-of-attempts structure. |
| F06 + F07 | retained overlap | Pending entries still refer to attempts; failure storage moves to session with a current-attempt guard. Lifetime overlap and failure authority are not the same relation. |
| F08 → F09 | reuse then contract cut | `4c382d75` updates F08's baseline comment and removes predicate pruning; it preserves diffing publishedRows against privateRows. |
| F10 recursive suffix → per-request membership | substitute/enabling reuse | `d03177ac` changes completion callbacks to register the next request without returning its suffix; the existing operation tracker supplies chain completion. |
| F11 confirmed boundary → emitted-cursor deletion | substitute | `88fad51b` stops taking getBiggest and establishes sourceBoundary. `5e61e9ca` later removes the old emitted-row tracker and derives invalidation from contributions. These are different facts, not a rename. |
| F12 replay sequencing → retained window failure | addition/qualification | `e6c8da4f` introduces source-recovery waiting; `92b6c536` adds a separate publication guard that source success cannot clear. No evidence that replay alone subsumes window outcome. |
| F14 builder set + pending scheduler jobs | separate cuts | `832bf765` removes the builder's duplicate dependency representation. `84d788c5` removes completion bookkeeping that could misclassify a reentrantly queued replacement. They share a scheduling boundary but neither becomes the other's storage. |
| F15 → F16 | no established derivation | Similar first-error/cleanup behavior is not proof that effect cleanup derives from the callback helper. F16 has retryable physical work and its own reentry rule. |
| F16 reduction → reentry correction | corrective addition | `b09f7765` directly repairs the preceding effect-set simplification. It preserves the smaller set while restoring failed outer-call ownership. |

## Formation section

Arrows below mean the transformations listed above, not a universal progress
story. Rows coexist at the frozen head; horizontal placement between rows does
not imply causation.

```text
INHERITED / EARLIER FORM       TRANSFORMATION                    SURVIVING FORM
outcomes/provenance extension ── module/extent cut ────────────> exact settlement
predicate + abort-lease reuse ── overwrite ────────────────────> exact-key reuse
logical demand fields ───────── explicit states/object lease ─> demand + acquisition
replay attempt sets ─────────── flat membership ─ correction ──> bounded attempt provenance
per-attempt failures ────────── current-authority cut ─────────> session failure map
public baseline copies ──────── reuse ────────────────────────> publishedRows + privateRows
predicate release pruning ───── delete/reconcile stale rows ──> source-owned retention
recursive page promises ─────── per-request registration ─────> operation-scoped chain
emitted-row cursor ──────────── evidence substitution ─────────> source boundary + contributions
source/window completion ────── scoped guards ────────────────> distinct outcomes
dependency/completed mirrors ── independent cuts ─────────────> builder set + pending jobs
effect cleanup copies ───────── failed-only set ─ correction ─> retryable failed callbacks
lazy demand segments ────────── identity/error adjustments ───> retained segment layer
```

No relation-graph cycle was found among these recorded transformations. Returning
to a similar field shape (F06) is not a historical cycle: it is a later occurrence
with different storage and a named constraint. The relation graph is incomplete,
not a proof that the entire code history is acyclic or correctly modeled.

## Reconstruction control and surviving seams

The named parent/commit hunks reconstruct the recorded fields and call sites:
exact dedupe does not need the removed outcome modules; flattened replay retains
bounded startup provenance; the existing public image replaces its extra copy;
per-request observers compose through the operation tracker; current scheduling
uses pending work rather than a second completion fact. This is a local
source-reconstruction control, not byte-for-byte regeneration of all 13 files or
execution proof. Unopened hunks remain outside the reconstruction.

Several responsibilities still cross files. Their coexistence is observed;
their redundancy is not established by this instrument:

- Sync tracks collection-wide loading and imperative-operation participants;
  subscription tracks logical ownership, scoped status and replay publication;
  OrderedSourceLoader tracks continuation evidence; the builder holds public
  output and the requested/settled window distinction. F01 predates this stack;
  later code reused it rather than inventing every wait set anew.
- Lazy segments (F17), exact request reuse (F03), and subscription acquisition
  ownership (F04) all involve demands. Their keys, consumers and release effects
  differ in the admitted source. Their names alone do not establish one module.
- Failed-only effect cleanup and subscription cleanup debt both retain failed
  release work. The history supports similar pressures, not a proven common
  lifetime or safely interchangeable cleanup function.

The history has already removed several obvious mirrors: extra replay baseline,
emitted-row cursor, builder dependency map, scheduler completion set, per-attempt
failure maps and callback-loop copies. The surviving layers cannot be classified
as obsolete solely because an earlier representation was deleted.

## Phases, unknowns and distortion

One optional grouping is by representation change: broad result/reuse protocols;
exact request plus retained publication; bounded lifecycle corrections; removal
of secondary bookkeeping. This grouping is analytical, not a release sequence:
the source histories interleave and several baseline components survive across
all groups. The unit/relation registers remain the primary record.

The Formation section alone does not identify which surviving seam should be
unified, moved into D2 or rewritten as a state machine. It records the supported
history and what a later candidate would need to account for. No new correctness
bug, dead-code proof, performance claim or implementation recommendation follows.

Selecting recognizable reduction/correction pairs can overstate that pattern
and underrepresent quiet unchanged code. Commit subjects can suggest intention
not proven by hunks. The bulk import obscures ancestry. The detailed reading is
deepest in subscription/ordered-loading/scheduling paths, lighter in collection
state/lifecycle and adapter behavior. These limits remain open; the two separate
Design grammar readings have not been used to fill them in.

## Post-commit loss audit qualifications

A fresh source-bounded audit of the original report at dce182aa is preserved in
[loadsubset-wide-formation-loss-audit.md](loadsubset-wide-formation-loss-audit.md).
The following qualifications supplement, rather than replace, the unit register.
They do not establish a new bug or select a simplification.

- F02: the added options module relocated inherited request cloning as well as
  adding demand snapshots. Cloning survives its deletion in subset-dedupe.
  The same outcome cut also replaced a deferred-options translation registry
  with shared acquisition-object identity; that is separate from F04.
- F04: logical demand versus physical acquisition already existed at baseline.
  The named commits add lifecycle states and then nest an acquisition object;
  they did not invent the ownership distinction.
- F03: completed exact reuse can serve a signaled caller. Only pending sharing
  excludes signals; generation and abort fences govern completion caching.
- F01/F10: completion covers registrations belonging to the applicable active
  operation. Older operations retain existing work but do not absorb new
  registrations belonging to a superseding window.
- F05–F07: replay counts logical acquisitions separately even when promises
  are shared; flattening storage did not turn membership into promise dedupe.
- F09: stale-row reconciliation runs outside truncate buffering. An ordinary
  snapshot cannot reopen a failed private replay.
- F11: ordered evidence comes from a local range read after fulfillment of the
  exact request, relying on the adapter contract. Empty ranges preserve a prior
  safe boundary and do not prove exhaustion. Local prefix counting still costs
  work even when transport is reduced.
- F14: scheduler blocking also queries a dependency's pending-graph state,
  not just its own job map. Builder dependency snapshots precede reentrant setup.
- F13: a lease gets a pending result only after lease/minimum-limit checks and
  only when that promise matches the current desired limit.
- F17: nonfailed segments survive any overlap; partial shrink does not split
  their ownership. Unchanged nonfailed demand is not a fresh aggregate wait.
  Failed intersecting segments defeat that fast path and are reacquired.

All eleven audit entries remain available, including source anchors, mechanisms,
preserved material and scope limits. These additions correct possible overbroad
readings of compact arrows; they do not convert the Formation section into a full
runtime specification.
