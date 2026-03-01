# Query engine evolution exploration

Status: draft design note  
Branch context: `cursor/recursive-includes-exploration-41e3`  
Related: [Recursive includes exploration](./recursive-includes-exploration.md)

## Goal

Explore an evolution of the TanStack DB query engine with these requirements:

1. **On-demand collections emit row version/LSN metadata** so queries can provide stable transactional guarantees.
2. **One mutable query graph for all live queries** (compile + match + amend), instead of one graph per live query collection.
3. **Minimize join index state** by treating it as computed-graph (CG) cache and re-fetching via up-queries when needed.
4. **Route up-queries through operators** so they can be transformed/composed by the query engine.
5. **Introduce single-dimensional or multidimensional version/time** so joins can withhold output until required up-queries are satisfied.

This note is intentionally architecture-first and code-adjacent.

---

## Current baseline (important context)

### 1) Query graph lifetime is per live query collection

- `CollectionConfigBuilder` builds a query IR and compiles a `D2` graph for that live query.
- `compileBasePipeline()` creates `new D2()` and input streams per alias.
- Graph/pipeline caches live within that builder instance and are reset on sync cleanup.

Implication: there is no shared global graph structure across independent live queries today.

### 2) `loadSubset` is invoked directly from subscriptions and join lazy-loading

- `CollectionSubscription.requestSnapshot()` / `requestLimitedSnapshot()` call `collection._sync.loadSubset(...)`.
- Lazy join loading in the compiler (`joins.ts`) calls `lazySourceSubscription.requestSnapshot(...)` when join keys are missing.
- This means up-query intent is generated in query code paths, but execution is pushed directly to source sync handlers.

Implication: up-query planning is not a first-class operator pipeline stage.

### 3) Core `db-ivm` runtime is versionless

- `@tanstack/db-ivm` streams carry diffs (`MultiSet`) without explicit timestamps/frontiers.
- `D2.run()` drives operators until quiescence based on pending input queues.
- There is no graph-level frontier contract in the current runtime.

### 4) Version/tx tracking exists in adapters, not in core query graph semantics

- Electric adapter has `txid` tracking (`awaitTxId`, `awaitMatch`, `up-to-date`, `subset-end` controls).
- This gives useful consistency behavior for that source, but it is source-specific and not exposed as a general graph contract.

---

## Desired semantics

The requested direction implies these invariants.

### A. Stable transactional visibility token per query

Each query result should have a monotonic "stable through" token (epoch/frontier-like), so consumers can reason about how complete the result is.

### B. No premature join emission when data is missing

If a join row depends on missing side data and an up-query was issued, the join must not emit a "final" row for that dependency until the up-query is satisfied for the required version horizon.

### C. Eventual convergence despite sparse version streams

We may skip intermediate versions in emitted rows, but eventual output must converge to the correct result once enough data has arrived.

### D. Bounded state with controlled re-fetch

Join state should be treated as a cache. Evict aggressively where safe, and rely on operator-routed up-queries for replay/fill.

---

## Proposed architecture

### 1) Versioned row contract for on-demand collections

Introduce a normalized row-stamp shape that can travel through sync adapters and operators.

```ts
type RowStamp = {
  sourceId: string
  lsn?: bigint | number | string
  epoch?: number
}
```

Possible representation choices:

- **Non-breaking first step:** put stamp in `ChangeMessage.metadata`.
- **Stronger typing later:** add first-class typed version fields in internal message envelopes.

Key idea: LSN/source version and graph-level epoch are related but not identical.

- `lsn` answers "which source commit did this row reflect?"
- `epoch` answers "which global graph progress point did this message enter?"

### Source frontier signal

To make gating composable, sources should also expose a monotonic frontier/high-watermark (explicitly or by convention), e.g.:

```ts
type SourceFrontier = {
  sourceId: string
  stableLsn?: bigint | number | string
  stableEpoch?: number
}
```

---

### 2) One mutable global query graph

Introduce a graph manager (conceptual name: `GlobalQueryGraphManager`) that owns one runtime graph and supports attach/detach of logical queries.

### Attach flow (conceptual)

1. Normalize query IR into canonical operator fragments.
2. Fingerprint each fragment (operator kind + normalized args + upstream fingerprints).
3. Reuse existing nodes when fingerprint matches; create only missing nodes.
4. Attach query sink to terminal node(s) and increment refcounts.
5. Return current snapshot plus stability token.

### Detach flow

1. Decrement sink reference count.
2. Garbage-collect unreachable nodes/operators and operator-local caches.
3. Optionally keep warm caches for a short TTL if churn is high.

### Why this matters

- Natural sharing of common subplans (especially joins/filters/order nodes).
- Shared backpressure and consistent frontier accounting.
- Foundation for query-level and global-level up-query coalescing.

---

### 3) Up-queries routed through operators

Move from "subscription directly calls source `loadSubset`" to "operators emit up-query needs and an up-query router executes them."

### New internal message types (conceptual)

```ts
type UpQueryNeed = {
  needId: string
  sourceAlias: string
  load: LoadSubsetOptions
  requiredEpoch?: number
  requiredLsn?: bigint | number | string
  requestedByOperatorId: number
}

type UpQueryAck = {
  needId: string
  satisfied: boolean
  satisfiedEpoch?: number
  satisfiedLsn?: bigint | number | string
  error?: unknown
}
```

### Flow

1. Join/lookup/index operator detects a hole (missing row/state).
2. Operator emits `UpQueryNeed` into an internal control stream.
3. Up-query router/planner:
   - deduplicates needs,
   - coalesces by source + compatible predicates,
   - rewrites into richer `LoadSubsetOptions` when possible.
4. Sync bridge executes source-specific `loadSubset`.
5. Source changes re-enter graph as normal row deltas with stamps.
6. Router emits `UpQueryAck` and advances obligation state.

This makes up-queries composable and observable within the graph itself.

---

### 4) Partial-state joins (minimum practical state)

Treat join indexes as a hierarchy of caches, not durable truth.

### State tiers

1. **Obligation state (required):**
   - unresolved needs,
   - required epoch/lsn horizon,
   - pending keys.
2. **Key skeleton state (small):**
   - key existence,
   - minimal join attributes,
   - refcount/last-access metadata.
3. **Full row cache (evictable):**
   - only hot rows required by active outputs/windows.

### Eviction strategy

- Evict cold full rows first.
- Keep small key skeleton and obligations.
- Re-issue up-query when evicted row is needed again.

### Safety rule

Eviction is safe only if unresolved dependencies are tracked via obligations so output gating remains correct.

---

### 5) Time/version model options

#### Option S1: global single-dimensional time + source frontiers

Representation:

- Global epoch `e: number` for graph progress ordering.
- Source-local LSNs for provenance.
- Frontier map: `source -> stableEpoch/stableLsn`.

Pros:

- Much lower complexity than full multidimensional time.
- Enough to express "do not emit join output until up-query for epoch `e` is satisfied."
- Good fit for immediate transactional tracking goals.

Cons:

- Less expressive for nested iterative operators/recursive fixed points.
- May require conservative gating in complex feedback cases.

#### Option S2: multidimensional time + antichain frontiers

Representation:

- Version vectors (for example `[epoch, iter]`, potentially more dimensions).
- Antichain frontiers as in Differential-style progress tracking.

Pros:

- Strongest formal model for recursion/feedback and concurrent iterative subcomputations.
- More precise progress and less conservative gating in advanced plans.

Cons:

- Significant complexity tax across streams/operators/runtime APIs.
- Larger cognitive and implementation overhead for debugging/tooling.

#### Critical assessment for recursive includes and aggregates

When we evaluate S1 vs S2 specifically for recursive query workloads (includes that recurse, per-level aggregates, and multi-level includes), the trade-off is less about "can we make it work?" and more about "where does complexity live?"

| Dimension | S1 (single dimension) | S2 (multidimensional) |
|---|---|---|
| Recursive fixed-point progress | Requires operator-local iteration bookkeeping layered on top of global epoch | Native representation of outer txn + inner iter progress |
| Recursive aggregates with retractions/deletes | Correctness often needs conservative barriers or localized recompute | Delta + frontier semantics are explicit, reducing ad-hoc recompute paths |
| Multi-level include composition | Can become conservative/global when one branch is slow | Supports finer-grained partial progress across branches/subtrees |
| Up-query gating under out-of-order arrivals | Feasible but tends toward custom gate logic per operator | Unified obligation/frontier reasoning across operators |
| Future expressive operators (topK/limits within recursion, advanced feedback) | Higher risk of semantic corner cases and bespoke fixes | Better long-term foundation for expressive recursive plans |

Critical observation:

- **S1 minimizes early runtime complexity but shifts complexity into operator-specific logic over time.**
- **S2 increases early runtime complexity but centralizes semantics, which usually lowers total complexity for expressive recursive evolution.**

#### Practical recommendation

For this evolution, with a goal of expressive recursive queries, **S2 should be the default target**:

- it gives the cleanest semantic model for recursive includes, aggregates, and multi-level composition,
- it avoids paying a migration tax later when S1 abstractions start to leak,
- it provides clearer correctness invariants for up-query gating and eventual convergence.

Adopt S2 with implementation guardrails:

1. Keep the external API simple (query-level stable token/frontier summary), even if internal time is multidimensional.
2. Scope V1 to minimal required dimensions (`[txn, iter]`), while keeping internal types extensible.
3. Implement only the first recursive-capable operators initially (join/lookup + recursive/aggregate path), then expand.

---

## Compiled pipeline sketch (operator-routed up-query + gating)

Pseudo-code showing the desired shape:

```ts
// Source streams emit row deltas + stamps.
const users = sourceInput(`users`)   // [key, row, stamp]
const orders = sourceInput(`orders`) // [key, row, stamp]

const usersById = users.pipe(
  indexBy(([, row]) => row.id, { evictable: true }),
)

// Join operator can emit:
// - joined rows when right side is present
// - UpQueryNeed when right side is missing
const joinResult = orders.pipe(
  lookupJoinWithUpquery({
    rightIndex: usersById,
    rightKey: (orderRow) => orderRow.userId,
    makeNeed: (orderRow, stamp) => ({
      sourceAlias: `users`,
      load: { where: eq(ref(`id`), val(orderRow.userId)), limit: 1 },
      requiredEpoch: stamp.epoch,
    }),
  }),
)

const needs = joinResult.needs
const candidates = joinResult.rows

const upqueryAcks = needs.pipe(
  coalesceNeeds(),
  routeToSyncLoadSubset(), // executes via source sync adapters
)

const stableRows = candidates.pipe(
  gateByObligations({
    acks: upqueryAcks,
    sourceFrontiers: sourceFrontierStream,
    canEmit: (candidate, obligationState) =>
      obligationState.isSatisfied(candidate.requiredNeeds, candidate.requiredEpoch),
  }),
)

const output = stableRows.pipe(projectFinalShape())
```

Important property: the query graph itself carries both data and control obligations.

---

## Query output contract (constant transactional guarantees)

Expose query-level stability metadata alongside rows:

```ts
type QueryStability = {
  stableEpoch?: number
  sourceFrontiers: Record<string, number | string | bigint | undefined>
  pendingObligations: number
}
```

Interpretation:

- Rows are guaranteed consistent through `stableEpoch` / frontiers.
- If `pendingObligations > 0`, output may still be incomplete due to outstanding up-queries.
- As obligations resolve and frontiers advance, snapshots converge.

This matches the intended "may miss versions now, eventually answer correctly" model.

---

## Mapping to Noria concepts

Noria-inspired concept mapping:

- **Partial materialization / holes** -> partial-state join with explicit obligations.
- **Upqueries** -> operator-emitted `UpQueryNeed` + router + ack stream.
- **Replay/backfill paths** -> source reload via `loadSubset` through graph control plane.
- **Consistency progress** -> frontier/stability tokens at query outputs.

This preserves the core spirit (minimum resident state + on-demand replay) while fitting TanStack DB's live query model.

---

## Likely implementation touchpoints in this repo

If this direction is implemented incrementally, the likely first touchpoints are:

- `packages/db/src/query/live/collection-config-builder.ts`
  - transition from per-live-query graph ownership toward global graph manager integration.
- `packages/db/src/query/compiler/index.ts` and `packages/db/src/query/compiler/joins.ts`
  - emit/operator plans for up-query control streams and obligation-gated joins.
- `packages/db/src/collection/subscription.ts`
  - migrate direct snapshot-triggered up-query calls toward routed control-plane hooks.
- `packages/db/src/collection/sync.ts` and `packages/db/src/types.ts`
  - extend `loadSubset` contract for explicit acknowledgements/frontier metadata.
- `packages/db-ivm/src/*`
  - add internal message shape support for stamps/frontiers and control streams.
- `packages/query-db-collection/src/query.ts` and adapter packages (`electric-db-collection`, etc.)
  - provide source frontier/version metadata and ack semantics from concrete sync implementations.

---

## Phased rollout plan

### Phase 0: instrumentation and invariants

- Add metrics for:
  - join index memory,
  - loadSubset volume and latency,
  - duplicate up-query ratio,
  - time-to-stable for live queries.
- Add invariant checks around monotonic stability token progression.

### Phase 1: operator-routed up-query control plane (no global epoch yet)

- Introduce `UpQueryNeed`/`UpQueryAck` internal streams.
- Route existing lazy join loading through router operator instead of direct calls.
- Keep current runtime mostly intact; gate only by ack completion.

### Phase 2: global mutable query graph manager

- Implement canonical node matching and sink attach/detach.
- Move per-query compilation into "compile-and-merge" against global graph.
- Add reference-counted node lifecycle and cleanup.

### Phase 3: multidimensional time/frontier core (Option S2)

- Add version vectors (initially `[txn, iter]`) and antichain frontier plumbing in runtime/operator messages.
- Upgrade obligation gate from "ack only" to multidimensional frontier-aware satisfaction checks.
- Expose a simplified query stability token/frontier summary to consumers.

### Phase 4: recursive includes and aggregates on S2

- Implement recursive include operator path against S2 frontier semantics.
- Implement recursive aggregate correctness tests (insert/update/delete/retract scenarios).
- Validate multi-level include behavior with mixed loaded/unloaded branches.

### Phase 5: partial-state join eviction

- Introduce tiered join caches (obligation + key skeleton + evictable full rows).
- Add adaptive eviction policy and anti-thrash controls.
- Ensure eviction/reload correctness under recursive pipelines.

### Phase 6 (optional): dimension expansion beyond `[txn, iter]`

- Add extra dimensions only when required by concrete operators/use-cases.
- Keep dimensionality minimal by default to control complexity.

---

## Tests needed for confidence

1. **No premature join rows**
   - Join with missing side row must not emit final row until up-query resolves.
2. **Monotonic stability**
   - `stableEpoch`/frontier tokens must never move backward.
3. **Eventual convergence**
   - Delayed up-query responses eventually produce the correct snapshot.
4. **Eviction safety**
   - Evict/reload cycles preserve correctness under concurrent writes.
5. **Shared graph correctness**
   - Query attach/detach does not leak state or cross-contaminate outputs.
6. **Recursive aggregate correctness**
   - Aggregates over recursive includes remain correct under inserts, updates, and retractions.
7. **Multi-level include progress isolation**
   - Slow/deep branches do not unnecessarily block stable emission of unrelated branches.

---

## Open questions

1. Should `LoadSubsetFn` return an explicit ack payload (not only `Promise<void>`) for stronger obligation accounting?
2. Do we expose stability metadata in `useLiveQuery` APIs directly, or via debug/internal API first?
3. How should cross-source transactional guarantees be defined when sources provide incomparable LSN domains?
4. What are the minimal frontier semantics required for non-Electric sources?
5. Which operators should become up-query-capable first (join, order/limit, recursive operator)?
6. Under what concrete conditions do we need dimensions beyond `[txn, iter]`?

---

## Recommended direction

Build toward:

1. **operator-routed up-queries**,  
2. **single global mutable graph**, and  
3. **multidimensional version/frontier semantics (S2)** as the internal default for recursive correctness.

Given the goal of iterating quickly on expressive recursive queries (includes with aggregates and multi-level includes), taking on S2 complexity early is likely the lower total-cost path.
