# Design grammar: D2 and relational state

Two adjacent forms can be generated from this source: a D2 boundary for weighted demand-key presence, and a relational view of request-segment coverage. Neither establishes that moving the asynchronous lifecycle into D2 would simplify this system. The source contains several maps over the same keys whose facts differ by observer, time, or authority.

This is one complete, independent Design grammar extractor run, using the Field Lab skill and its design-grammar card. It returns generated samples, not a ranking or an implementation recommendation. Reconstruction and range checks below are source reasoning. No tests were run; test-source assertions are not executed proof.

## Frozen arrangement and source boundary

Commit: `1cec4d7f4669d1708800937a48eda0de8e9edaf9` in `/Users/kylemathews/programs/tanstack-db/.worktrees/codex-loadsubset-minimal-stack`. Every repository source was read with `git show` at that commit; local copies used for line-addressed reading were extracted from those blobs. Root and worktree AGENTS were read and compared equal. The full live-query architecture was read before live code. No sibling output, prior grammar, audit, design report, TODO conclusion, history survey, or discarded spike was read. No production or test file was changed.

Source anchors below are repository-relative paths and **frozen line numbers**, not claims about a later checkout. The primary source includes inherited implementation, not just the commit diff:

| Anchor | Observed responsibility |
| --- | --- |
| `packages/db/src/collection/subscription.ts:88–196, 274–903, 958–1237, 1270–1605, 1790–2009` | Logical subset demands, physical acquisitions, replay, subscription visibility, exact release debt, status and snapshot boundaries |
| `packages/db/src/collection/sync.ts:111–369, 551–940` | Source startup and applied commit interface, preload, operation participants, load-session fence, deferred loads, teardown |
| `packages/db/src/collection/state.ts:64–137, 368–451, 497–854, 854–1050, 1330–1491, 1567` | Synced and optimistic authority, causal queue, applied receipts, indexes and public change installation |
| `packages/db/src/collection/changes.ts:114–233, 241–377` | Deferred event delivery, subscriber ownership, publication context |
| `packages/db/src/collection/lifecycle.ts:68–211, 276–347` | Legal status transitions, ABA revision fence, first-ready effects, cleanup |
| `packages/db/src/query/live/utils.ts:113–191, 220–725` | Exact ingress reconciliation, weighted input encoding, ordered request policy and established source boundary |
| `packages/db/src/query/live/collection-subscriber.ts:33–468` | One lexical source's D2 ingress, loading bridge, lazy demand bridge, ordered loading and replay publication control |
| `packages/db/src/query/live/collection-config-builder.ts:298–387, 426–809, 824–1209, 1255–1400` | Window operations, demand readiness, graph scheduling, drain and coherent publication |
| `packages/db/src/query/live/subset-demand-controller.ts:11–193` | Canonical requested keys, retained request segments, intersection and newly uncovered keys |
| `packages/db/src/query/effect.ts:370–900, 956–1128` | Separate effect runner, source contribution maps, event accumulator, handler and disposal boundaries |
| `packages/db/src/scheduler.ts:21–273` | Transaction/publication-scoped job coalescing and dependency order |
| `packages/db/src/live-query-window-controller.ts:123–375, 685–951` | Shared max-limit lease policy, versions, rollback, pending versus settled window, controller participation |
| `packages/db/src/query/subset-dedupe.ts:7–203` | Exact canonical completion identity, restricted in-flight sharing, semantic option snapshots |

Direct imports were followed to constrain the grammar: `query/compiler/joins.ts:57–67, 380–465`, `query/live/materialized-pipeline.ts:205–275, 401–455`, and db-ivm `distinct.ts`, `reduce.ts`, `join.ts`, `consolidate.ts`, `tap.ts`. These are not an independent compiler survey. A form that changes the compiler callback is explicitly marked as crossing the primary source boundary.

Adapter boundary checks were limited to Electric `electric.ts:670–725`, Query DB `query.ts:2098–2148`, and PowerSync `powersync.ts:715–778, 855–889`. They constrain cancellation, receipts, and acquisition identity; they are not donor designs.

### Properties the account must preserve

1. Each lexical source key contributes at most one exact current source row to its query input. A deletion retracts the actual prior contribution, including when event payload history differs.
2. Query rows remain weighted relations. Public-key reduction checks congruence and rejects negative aggregate support. Multiple legitimate contributors are not duplicate delivery.
3. Active routes, empty bucket values, nested materialization, and fan-out remain in one D2 graph. A pending load does not hide a parent whose include has a canonical empty or partial value.
4. An active satisfiable key requires current settled coverage for initial readiness. Retired demand cannot pin readiness or a shared replay.
5. Request coverage is not row ownership. Unloading a predicate does not authorize core to delete every matching row.
6. Adapter startup, release, and status delivery may reenter. Tentative ownership must exist before adapter startup. A synchronous startup throw establishes no unloadable acquisition. Logical release is final even if physical release becomes debt.
7. An applied receipt settles after its writes and events are visible. Persistence queue order, immediate/truncate prefix behavior, and the point of irrevocable application survive.
8. Public root/facade state, synchronous reads, event payloads, and downstream queries observe a complete graph result. Replay failure keeps the last complete publication visible; new source rows may already exist privately.
9. Ordered coverage comes from a successful exact request. Local rows, requested limits, and promise success alone cannot prove a broader prefix or exhaustion. Failed coverage takes the authoritative recovery route.
10. Window requests, settled windows, controller leases, and physical top-K state need not agree while work is pending. Generation fences prevent old completions from accepting a replacement window.
11. The no-includes path, direct subscription path, effect callbacks, and adapter lifetimes do not acquire hidden recursive Collection machinery. Retained state must be bounded by current relations, live work, visibility baselines, and cleanup debt, not all past events.

Items 1–10 are observed rules or architecture contracts. Item 11 combines the architecture's fast-path/space laws with an analyst preservation requirement against adding an unbounded event log. It does not assert measured space.

## Candidate primitives: observation versus inference

These are candidates, not atoms. Several are deliberately overlapping.

| Candidate | Observation and trace | Inferred reusable boundary |
| --- | --- | --- |
| Weighted contribution | `sendChangesToInput` encodes insert `+1`, delete `-1`, update `-old,+new`; `materialized-pipeline.ts:224` retains public-key contributors | A relation can derive presence and canonical value once valid deltas reach it. It cannot infer an omitted old value from an imperative command without retained authority. |
| Observer-relative row register | Subscription `publishedRows`, `sentKeys`, `stalePublishedRows`; subscriber `sentToD2Rows`; effect `sentToD2RowsBySource` | “Known row” must include **known by whom, at which publication phase**. A common key type does not establish a common state owner. |
| Demand-key presence | Join compiler `demandWeights` sums weights, ignores null keys, selects positive support, then calls `setDemand`; controller canonicalizes equality keys | Presence is derivable from a weighted relation. Raw value representatives still need the query's equality/reference semantics. |
| Coverage segment | Controller `DemandSegment` records immutable acquisition keys, predicate, abort controller, promise, and outcome | Segment membership is a relation; its abort handle and outcome observation are effect state. Segment identity must survive partial shrink. |
| Logical owner / physical incarnation | Subscription separates `SubsetDemand` from `SubsetAcquisition`, session identity and cleanup debt | This is a reusable lifetime pattern at adapter boundaries, not a data-plane row reduction. |
| Participant | Replay and status sets retain participants per logical acquisition even when promises are shared; sync operations retain causal promises | Participation is keyed by the waiter's question, not simply by promise identity. A readiness participant and a replay participant can have different membership. |
| Establishing receipt | State marks `applicationStarted` before events, resolves receipts afterward; source loads return/await receipts | A receipt is evidence of an effect's completion. It cannot be replaced by relation nonemptiness. |
| Settled coverage boundary | Ordered loader stores one `sourceBoundary`, reads a request-constrained snapshot, and invalidates on relevant mutations | Boundary plus successful request authority is distinct from current maximum row. A second top-K cannot manufacture that evidence. |
| Coherent publication | Builder accumulates canonical deltas and defers publication while barrier predicates hold; changes manager delays events, not state/index installation | Publication is an effect boundary consuming graph output. The already canonical output still needs temporal accumulation across graph runs during a barrier. |
| Versioned operation | Status revision, graph session, acquisition generation, window generation, and lease version | Tokens protect different reentrancy/async boundaries. Their similar shape is insufficient reason to unify their clocks. |

Two recurring patterns have enough context to name. **Presence to demand** responds to many parent rows sharing one child key: retain weighted support, derive positive keys, acquire newly uncovered work. Its smaller units are equality identity and contribution; its larger units are source readiness and graph materialization. **Retire before cleanup** responds to callbacks that reenter or fail: remove logical participation first, keep exact physical debt until release succeeds. Its smaller units are incarnation and participant; its larger unit is subscription teardown. Neither pattern owns source row deletion.

### What the apparently duplicated facts actually mean

`sentKeys` is a subscription's filtering/snapshot membership aid and is sometimes deliberately bypassed (`loadedInitialState` or `skipFiltering`). `publishedRows` records that observer's values. `privateRows` is the bounded unfinished direct replay replacement. With a query's `truncateReplayPublication` hook, changes instead flow into private D2 state; the subscription does not buffer those same deltas in `privateRows` (`subscription.ts:1270–1311`). `sentToD2Rows` supplies the exact old contribution and is also read by ordered invalidation. Deleting it just because subscription has a map would need an exact cross-path invariant that this source does not expose as an interface.

Similarly, `pendingLoadSubsetParticipants`, replay `pending`, sync `pendingLoadSubsetPromises`, builder `activeDemands`, and window-operation participants ask different questions. An ordinary pre-replay acquisition can block readiness without blocking replay publication. A released owner can remove still-unsettled work from a replay. Settled failed replay state can keep publication closed even when no promise remains pending. No single count captures those distinctions.

## Rules, conflicts, and priorities

**Observed combination rules**

- R1: Normalize equality identity before deriving membership. Null/unsatisfiable demand can be excluded while an empty materialization remains active.
- R2: Preserve positive weighted support until the last contributor leaves. Do not use an idempotent source-command rule to collapse legitimate bag multiplicity.
- R3: A nonfailed segment remains while **any** current key intersects its keys; it need not be a subset of the current key set. Request only current keys not covered by retained segments. Release on empty intersection or failure. (`subset-demand-controller.ts:44–112`.)
- R4: Install the owner and captured replay attempt before calling the adapter; after each reentry, check owner/session/attempt again. Release failures retire logical demand while retaining physical debt.
- R5: Drain synchronous graph work, including source writes caused by loader callbacks, before publishing. Keep source-recovery and ordered-operation barriers outside the graph.
- R6: After finite coverage fails or order changes invalidate it, use authoritative source recovery rather than derive a new cursor from arbitrary local rows.
- R7: Exact request dedupe uses semantic option identity; independent abortable in-flight requests do not share without a separate ownership protocol (`subset-dedupe.ts:24–27`).
- R8: Cleanup invalidates sessions before adapter teardown. It aborts unfinished waits and does not invoke first-ready callbacks. Physical debts never cross into a replacement adapter session.

**Allowed transformations:** substitute an existing relation operator for derived relation bookkeeping; split pure coverage derivation from effect execution; expose a narrow delta boundary instead of repeatedly exporting full sets. These are analyst generation rules constrained by R1–R8, not already declared APIs.

| Tension | Source-supported priority or unresolved branch |
| --- | --- |
| Exact active keys versus retaining work for departed keys | R3 gives retention priority while any key still needs the segment. The controller's introductory comment says removals rebuild covered segments, but its executable condition retains intersecting segments; the partial-shrink test supports the latter reading. |
| Relational equality versus event order | Unresolved for a blanket substitution. `tap` invokes callbacks per multiset; `distinct.run` folds all input messages before emitting. A drop/re-add may disappear at the new boundary while current code aborts and reacquires. Final-state equivalence does not grant permission to erase that timing. |
| Broad dedupe versus cancellation independence | Independent cancellation wins without a shared lease protocol. The join-dedupe test includes an exact expected-failure guard for cross-query reuse; it must not be reported as a passing reuse guarantee. |
| Early rows versus complete replacement | Ordinary progressive rows are allowed; replay/window publication gates retain old public state. These are distinct conditions, not a single “wait for everything” policy. |
| Fewer counters versus immediate reentry safety | Source requires tentative ownership and setup participation before callbacks. Replacing them with later graph output would change ordering. |
| Relational row absence versus provider completeness | Exact successful request and applied receipt win. Absence from local D2 cannot establish absence from the remote source. |

## Overlap, containment, dependencies, and modules

The topology is not a tree. A route participates in materialization and demand; a coverage segment participates in multiple active keys; an acquisition participates in ownership, readiness, and possibly replay. A public row belongs to Collection state and publication history but is not a request owner.

The **active-key ∩ segment-key intersection** is an active unit: it decides whether work remains reachable, whether the segment can be retained, and which pending work matters. It deserves explicit identity in a relational form. The **logical-owner ∩ acquisition ∩ replay-attempt intersection** is also active: it decides whether settlement gates publication. Assigning it only to “the promise” erases release and overlap behavior. The **query-private-state ∩ publication barrier** owns the complete replacement; assigning it to public Collection state would violate the scratch-state prohibition.

| Unit | Depends on | Interface / module claim |
| --- | --- | --- |
| D2 relation operators | Weighted rows, equality identity, same graph | Defensible module: existing operator interfaces, source implementation, architecture contracts, query oracle suites. `join` explicitly rejects streams from different graphs. |
| Demand controller | Canonical keys, plan, subscription request/release, promises | Bounded effect adapter interface exists. Not a fully independent pure module: startup can synchronously write source rows, and its ready result feeds builder operations. |
| Subscription replay | Collection sync session, demand owners, source events, optional publication hook | Defensible boundary adapter, not independent state machine with no Collection coupling. Direct and graph consumers have different buffer owners. |
| Ordered loader | Subscription indexed snapshot, compiler comparator/dataNeeded, window operation | Bounded policy adapter with explicit methods and ordered test suites. Its dependencies prevent treating it as a pure top-K operator. |
| Scheduler / publication | Jobs, dynamic pending checks, Collection event context | Defensible scheduling module with integration points; it preserves callback order and causal batching, not query relation state. |
| Window coordinator | Lease map, target `getWindow/setWindow`, caller rollback/version | Interface exists, but a max reduction replaces only the desired-limit scan. It does not own accepted physical state, baseline restoration, or promises. |
| Adapter retention | Electric stream, Query cache ownership, PowerSync trigger/hooks | External boundary. Core demand relations cannot acquire these lifetimes by renaming keys. |

There is no sourced basis for a new universal lifecycle graph, a global arrangement service, or a shared timestamp/frontier framework. Existing D2 operators retain their own indexes; adding a join is additional retained state unless measurements establish replacement or sharing.

## Reconstruction control

Using the candidates and R1–R8, the source can be reconstructed at its observable boundaries:

1. A Collection commit becomes irrevocable, installs synced/optimistic visible state and indexes, then delivers one publication-context batch and settles its receipt. Each lexical source subscription receives its own filtered view.
2. The observer-relative register reconciles duplicate snapshots and exact old rows. Weighted contributions enter the compiled graph. Repeated aliases remain distinct inputs.
3. The graph reduces public-key contributors, derives routes and active buckets, seeds empty values, composes child materialized rows upward, and derives positive nonnull demanded keys. Demand keys reach the effect adapter.
4. Coverage intersection retains surviving nonfailed segments. Newly uncovered keys form a new segment. The subscription installs its logical owner and physical incarnation before calling the source; promise settlement returns through session-aware observers. New source rows reenter step 1.
5. Builder demand generations accept only current settlement. Nonlazy/eager sources still require Collection readiness. Graph drain and canonical output accumulation precede public readiness.
6. On truncate, a replay session preserves the publication baseline, records setup participation, aborts replaced work, and defers reacquisition until truncate deletes have arrived. Direct subscribers fold private replacement rows; graph consumers feed private D2. All work started inside replay belongs to its captured attempt until settlement or owner retirement.
7. Success publishes the coherent replacement before ready. Failure keeps the gate and prior public rows. A last-demand release can retire the unreachable replay, but cannot predicate-delete independent retained source rows. Physical unload debt remains retryable.
8. Ordered loading reads exact successful request ranges to establish a boundary, refines ties/refills, and includes the chain in its operation. Failure invalidates coverage. Window leases request a max prefix while accepted window state follows successful completion and generations.
9. Cleanup discards graph/private state, invalidates sessions, aborts waits, and retires logical ownership before physical retries. A new sync session reacquires detached surviving demand with a new barrier.
10. Effects use the same contribution and demand helpers, but classify graph-run deltas into handlers rather than publish a root Collection. They retain independent handler promises and disposal behavior.

**Control result:** no essential source boundary needed a new primitive after adding observer-relative registers and the distinct participant constituencies. A first reduction to “rows, keys, promises” was insufficient: it could not reconstruct failed replay privacy or reentrant release. The revised grammar explains those with explicit overlap and authority. This is a semantic reconstruction, not an executable reimplementation or proof of every line.

## Range, dynamics, constraints, and boundary conditions

**Dynamics:** weighted insert/retract/update; positive presence; segment intersection and uncovered-key acquisition; generation-checked settlement; replay replacement; ordered refinement and authoritative recovery; lease-max requests with rollback.

**Constraints:** exact contribution conservation; canonical equality; no predicate-based row deletion; tentative ownership before reentry; applied settlement; coherent publication; per-constituency readiness; cancellation/session fences; bounded retained state.

**Boundary conditions:** one acyclic compiled query graph, single run order, JavaScript synchronous callbacks plus promises/microtasks, Collection-index capabilities, query order expressibility, concrete provider retention/cancellation support, current sync session, requested limit/offset, and current route/demand cardinality.

### Sourced matched marginal case

The ordinary shared case has two parents with active keys `{1,2}` covered by one settled request segment `{1,2}`. The marginal case changes only parent reachability to `{1}`. In `packages/db/tests/query/includes-temporal-oracle.test.ts:1177–1252`, `expectPartialShrinkRetainsCoverage` loads both keys, deletes parent 2, asserts parent 1's comments remain and `unloads` is empty, then deletes parent 1 and asserts the one unload has keys `[1,2]`.

R3 yields a **parameter change**, not a changed rule: the intersection shrinks from two keys to one, then zero. The segment is not rebuilt at one key. This matches the controller's executable intersection condition. It also demonstrates why deriving an exact-current-key predicate and releasing the old broad predicate could delete still-needed rows at an adapter boundary.

This source comparison does not hold all runtime scheduling fixed and was not executed here. Async expansion is independently represented in `expectRetainedDemandBlocksReadiness` (`includes-temporal-oracle.test.ts:778–812`): resolving new key 2 before old key 1 must not complete preload. That extends the candidate account to retained pending segments by inspection, not measured range.

### Negative exclusion

An out-of-family state is “after a failed replay writes version 2, publish that version merely because it is now the local current row.” `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts:313–341` asserts core version 2, public version 1, and only the original insert batch after rejection. The grammar excludes the proposed state because current source relation and authoritative public replacement are different primitives linked by a success gate.

A second overbreadth check is raw `distinct` on source keys as a substitute for `reconcileChangesForD2`: insert old row, receive a duplicate insert, then delete once. Source command idempotence requires absence after deletion; a weighted distinct counter can remain positive after two inserts and one delete. Worse, selecting only by key can suppress a changed value. Existing graph operators consume valid weighted deltas; they do not supply the ingress command contract automatically.

Both exclusions are source reasoning, not executed tests. The Electric boundary further limits universality: `electric.ts:678–682` records that `requestSnapshot` sends rows without a request signal/identity before its promise resolves. Core cannot derive request-scoped cancellation from relation equality when the provider withholds that identity.

## Generated adjacent forms

Only two forms are returned. A third wholesale “replay/readiness in D2” form would need new effect scheduling or callback priorities beyond the source. A “window max in D2” form would replace a short scan while introducing a separate graph and leaving all versioned effect state; the source provides no supported integration advantage that would make this more than relocating one calculation. These omissions are bounds on generation, not rankings.

Pseudocode is deliberately abstract. `row token` means the existing equality identity plus retained raw representative; a raw opaque object must not be structurally collapsed. Deletion surfaces are **rough estimates, not measurements**, exclude new code, and are not net savings.

### Form A — D2 owns weighted demand-key presence

**Route:** substitute a relation operator at the existing demand boundary. Changed variable: who retains positive key support. The physical segment policy and subscription acquisition boundary stay external.

Observed support is the compiler's `demandWeights` tap and the existing `distinct` operator, together with `createActiveBuckets` already using `distinct`. The form crosses the primary scope through the direct `LazyCollectionCallbacks` interface: actual implementation would need a compiler callback change. That change is a generated dependency, not an inspected compiler-wide design.

```ts
// Same query graph. Preserve the ordinary active-row branch unchanged.
const activeKeys = activeRows
  .map(([joinKey]) => [equalityToken(joinKey), equalityToken(joinKey)])
  .filter(([token]) => !token.isNullish)
  .distinct(([, token]) => token)

activeKeys.output(delta => {
  // External adapter boundary; D2 emits only presence transitions.
  for (const plan of plans) demandAdapter.applyKeyDelta(plan, delta)
})

applyKeyDelta(plan, delta) {
  // One current canonical key set still belongs to segment selection.
  // Its raw representatives come from the existing identity scope.
  updateCurrentKeysFromPresenceDelta(plan.keys, delta)
  const result = retainIntersectingSegmentsAndAcquireUncovered(plan)
  observeWithExistingBuilderDemandGeneration(result)
}
```

Preserved: equality partition, weighted last-contributor departure, sharing across keys, exact physical options, generation guards, active-key/segment overlap, and graph routes. New coordination: the delta callback must reach the demand adapter early enough that synchronous loads feed the same fixed point. Effects need the same callback capability. No Promise, abort controller, unload, or public Collection enters a relation row.

Affected anchors: `subset-demand-controller.ts:34–112, 143–166`; `collection-subscriber.ts:176–215`; `effect.ts:713–741`; imported constraint `compiler/joins.ts:417–454`. Plausible deletion: roughly 20–40 lines of compiler weight-map/full-set construction plus 10–25 controller lines for full-set equality/canonicalization, depending on compatibility glue. The controller's current-key set, segment handles and promise observations remain. New machinery: D2 distinct retained weights, token-to-raw-value access, a delta callback, and integration glue in both consumers. Without removing the old weight map, this simply adds a duplicate index. No claimed work/space improvement is measured.

**Timing branches and loss:** with one demand multiset per graph run, positive presence matches the existing map's final membership. With several messages in one run, existing `tap` can issue intermediate requests; `distinct` can consolidate them away. The form is therefore an adjacent form with **changed possible acquisition timing**, not an unconditional behavior-preserving substitution. Keeping old per-message cancellation would require a separate batching contract or operator behavior and cannot be silently assumed. Pending progressive loads and release/reentry may observe the difference even if query rows converge.

Existing oracle laws: contribution conservation, initial demand, stale demand, batch partition, and work/space; temporal source cases for retained pending demand, obsolete settlement, partial shrink, progressive fast-path delivery. The join-dedupe suite's “requests only a newly inserted join key” assertion applies, while its guarded cross-query reuse case remains an expected failure. Missing tests before any equivalence claim: two input messages in one graph turn that drop/re-add the last key; two parents leaving/entering the same key; synchronous adapter source writes at the new operator stage; equality-reference representatives across retractions; effects and includes under both batch partitions. No claim that existing tests already cover the new boundary.

### Form B — D2 derives segment reachability and uncovered keys

**Route:** split pure coverage derivation from the existing effect adapter, using joins, distinct, and anti-joins in the same query graph. Changed variable: where segment/key intersection and coverage subtraction live. It is structurally larger than Form A: established segment membership becomes a relation input, and adapter facts return to the graph.

```ts
// Pure relation rows, stable scalar IDs/tokens only.
ActiveKey(plan, keyToken)              // positive current demand
SegmentKey(plan, segmentId, keyToken)  // established or reserved request extent
UsableSegment(plan, segmentId)         // not failed/retired; tentative is usable

UsableMembership = SegmentKey JOIN UsableSegment ON (plan, segmentId)
ReachableSegment = DISTINCT(
  ActiveKey JOIN UsableMembership ON (plan, keyToken),
  by = (plan, segmentId)
)
CoveredKey = DISTINCT(
  UsableMembership JOIN ReachableSegment ON (plan, segmentId),
  by = (plan, keyToken)
)
MissingKey = ActiveKey ANTI_JOIN CoveredKey ON (plan, keyToken)
RetireSegment = UsableSegment ANTI_JOIN ReachableSegment ON (plan, segmentId)

afterDemandRelationsDrain(updateTicket) {
  // Only an existing setDemand invocation supplies a fresh action ticket.
  // A promise outcome may update facts but cannot independently start a retry.
  if (!externalHandles.claimCurrentDemandUpdate(updateTicket)) return
  // Capture the action batch; execute only in the established effect boundary.
  for (segment of retireActions) {
    if (!externalHandles.isCurrent(updateTicket)) return // unload may reenter
    retireLogicalRelationRows(segment) // before unload may reenter
    externalHandles.release(segment)  // subscription retains exact cleanup debt
  }
  for ([plan, missingTokens] of missingActionsGroupedByPlan) {
    if (!externalHandles.isCurrent(updateTicket)) return
    releaseFailedSegmentsForThisUpdate(plan) // exact failed handles, outside D2
    const id = freshSegmentId()
    reserveMembership(id, missingTokens) // before source startup/reentry
    const handle = externalHandles.start(plan, missingTokens)
    // Promise outcomes, generations, Error objects remain outside graph.
    observe(handle, {
      success: () => existingReadinessSettlement(handle),
      failure: () => { markUnusable(id); existingErrorPath(handle) }
    })
  }
}
```

The pseudocode's reservation is essential. Without it, synchronous source writes could derive the same missing keys again before the returned acquisition joins coverage. `afterDemandRelationsDrain`, reservation visibility, update tickets, and exception rollback are **new integration machinery**, not existing db-ivm APIs. They must fit the current graph's no-nested-run guard and source callback ordering. A synchronous startup throw removes the reservation and must not create an unload obligation. A cleanup/restart fence discards relation facts along with the owning graph and physical session. A failed segment is not silently retried on every drain; retry still follows a demand update or the existing explicit replay/operation path. The ticket is an added guard precisely because a purely reactive anti-join would otherwise turn asynchronous failure into an automatic retry.

Preserved: R3's partial-shrink intersection, immutable acquisition extent, newly uncovered-key loading, external cleanup debt, error identity, and active-key/segment overlap. Physical options and handles stay in an external `segmentId -> handle` registry. Builder `beginDemand/settleDemand` still observes the complete current segment set; the graph does not declare settled readiness from coverage presence. A segment can be reachable and pending.

Affected anchors: `subset-demand-controller.ts:11–112, 169–193`; `collection-subscriber.ts:176–215`; `effect.ts:713–741`; builder `426–453, 575–669` for the boundary integration; subscription startup/release `1134–1231, 1497–1525` remain constraints and are not deletion targets. The compiler's existing demand-key callback must feed `ActiveKey`, which crosses the primary scope in the same explicit way as Form A.

Plausible deletion: roughly 40–75 controller lines doing segment scans, key equality, intersection, covered-key construction, and added-key subtraction. New code includes relation wiring, action collection, external handle registry, reservation/rollback, outcome-to-input glue, teardown, and tests; it may exceed the deletion. Existing joins each retain input indexes, and `SegmentKey` adds state proportional to the total retained segment membership, not just currently active keys. Whole segment extents can be larger than the active set under the existing retention rule. A naïve all-plans grouping creates broad scans; keying by plan and key is required but is not measured here.

**Timing branches and loss:** a single stabilized action batch can merge missing-key changes that current per-call code acquires separately. Preserving the original segment partition requires preserving input callback batches, which can need more glue. Since segment partition determines shared abort lifetime, this is not merely a request-count optimization. The sample preserves value/coverage rules only under a stated stabilized-demand boundary; its exact cancellation and progressive timing are unresolved. It also moves relation-shaped metadata into the query graph that plain subscribers do not have, so it is limited to live-query/effect demand and cannot replace CollectionSubscription itself.

Existing oracle laws: initial demand, stale demand, applied settlement, publication, ownership separation, work and space. The matched shrink trace must still unload `[1,2]` only at zero intersection; the pending-expansion trace must wait for both segments. Missing tests: action reservation visible under synchronous `loadSubset` reentry; release triggers new demand; failed startup rolls back reservation without unload; two overlapping segments with one retiring; failure and partial shrink in one turn; old promise after graph restart; negative/positive batches that leave final keys unchanged; many retained segment members with few active keys and exact retained-index counters. These are required validation questions, not executed failures.

## Losses, injected rules, and unresolved limits

The D2 lens selected facts that look like relations and can understate callback-stack order, adapter cleanup, and public identity. The reconstruction corrected that distortion by separating authority and participant constituencies. It still compresses the full implementation into a small set of rules and cannot establish every throw/reentry trace.

The generation rules add a delta callback and, in Form B, a relation-drain action boundary plus tentative reservations. They are explicitly injected. The source supplies no priority allowing batch consolidation to override observable abort/reacquisition or fast-path progressive timing. Both forms name that loss instead of claiming complete structural preservation.

No form deletes the exact source contribution registers, replay-publication baselines, provider coverage boundary, applied receipts, operation promises, session generations, scheduler contexts, or physical cleanup debt. This is not a claim that those implementations are minimal; the extracted grammar does not prove a valid smaller owner for them. Equally, expressing coverage as relations does not prove fewer retained indexes or less work.

Range is source-calibrated by one matched marginal case and negative exclusions. General runtime range, deletion totals, net code size, performance, memory, and behavioral equivalence of the generated samples remain untested. The instrument stops here, with no ranking, synthesis across other runs, or implementation recommendation.
