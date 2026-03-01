# Recursive includes exploration

Status: draft design note  
Branch context: `cursor/recursive-includes-exploration-41e3` (includes subqueries in `select`, `toArray`, nested includes, per-parent aggregate/order/limit behavior)

## Goal

Support recursive hierarchical projection (adjacency-list style), while preserving the current includes performance model:

- one query-graph branch per include declaration (not one query per parent row),
- fan-out/materialization outside the query graph,
- incremental/live updates.

Example target (conceptual):

```ts
interface Node {
  id: number
  parentId: number
}
```

```ts
useLiveQuery((q) => {
  const children = withQuery(
    { pn: nodesCollection },
    q
      .from({ cn: nodesCollection })
      .where(({ pn, cn }) => eq(cn.parentId, pn.id))
      .select(({ cn }) => ({
        ...cn,
        children: children(cn),
      })),
  )

  return q.from({ pn: nodesCollection }).select(({ pn }) => ({
    ...pn,
    children: children(pn),
  }))
})
```

## How includes work today (important baseline)

### 1) Builder/IR phase

- In `buildNestedSelect` / `buildIncludesSubquery` (`packages/db/src/query/builder/index.ts`):
  - subquery values inside `.select(...)` are converted to `IncludesSubquery` IR nodes,
  - one correlation condition is extracted from child `.where(...)` (`eq(parentRef, childRef)`),
  - correlation predicate is removed from child query and stored as:
    - `correlationField` (parent side),
    - `childCorrelationField` (child side),
  - optional `toArray(...)` is carried via `materializeAsArray`.

### 2) Compiler phase

- In `compileQuery` (`packages/db/src/query/compiler/index.ts`):
  - includes are extracted from select,
  - each includes child query is compiled once (recursively) with a parent key stream,
  - child input is inner-joined against parent correlation keys,
  - child output tuple is `[result, orderByIndex, correlationKey]`,
  - select includes entries are replaced with placeholders; real fan-out is deferred to output layer.

This is the core "single branch, external fan-out" shape.

### 3) Output/materialization phase

- In `CollectionConfigBuilder` (`packages/db/src/query/live/collection-config-builder.ts`):
  - one output callback per includes entry accumulates pending child deltas by
    `Map<correlationKey, Map<childKey, Changes>>`,
  - `flushIncludesState` creates/updates/disposes child Collections,
  - `correlationToParentKeys` reverse index attaches one child Collection to all matching parents,
  - nested includes are handled with buffered bottom-up flushing,
  - `toArray` re-emits parent rows with array snapshots when child content changes.

### Why this is fast

- Query graph does not duplicate child queries per parent.
- Per-parent binding happens in output routing by correlation key.
- This is exactly the property we should preserve for recursion.

## Why recursive includes are not directly possible yet

1. **No fixed-point query representation in builder/IR**
   - Current includes require a concrete child `QueryBuilder` now.
   - There is no notion of "self call" node in IR.

2. **Compilation assumes acyclic query references**
   - `compileQuery` cache prevents duplicate work, but not cyclic query construction.
   - A true self-referential query would recurse indefinitely without additional cycle handling.

3. **Nested includes depth is static today**
   - Existing nested includes are explicit finite nesting in AST (`project -> issue -> comment`).
   - Recursive trees need unbounded/depth-dynamic expansion.

4. **Output flushing is level-structured**
   - Current nested buffering/routing works for known levels.
   - Recursive trees need dynamic level creation and pruning.

## Option status after this exploration

- **Option A (depth-limited unrolling):** compelling MVP route and syntax-compatible with a stronger future implementation.
- **Option B (per-node dynamic queries):** rejected.
- **Option C (output-layer recursive materializer):** currently less compelling given desire to solve recursion at the IVM graph level.
- **Option D (new recursive IVM operator):** most compelling long-term direction.

The rest of this document focuses on how to make Option D practical in `db-ivm`, while avoiding global multidimensional time unless absolutely required.

## Option D deep dive: recursive operator in `@tanstack/db-ivm`

### Key observations from the current codebases

1. `db-ivm` intentionally removed version/frontier machinery and runs until local quiescence (`D2.run()` loops while operators have pending work).
2. The original `d2ts` has `iterate` based on:
   - version extension/truncation (`Version.extend()` / `truncate()`),
   - per-iteration step (`applyStep()`),
   - frontier coordination in `FeedbackOperator`.
3. The DBSP paper explicitly supports recursion (including non-monotonic recursion) and models recursive incrementalization with nested time dimensions.

So we have a useful tension:

- Differential-style multidimensional time is expressive and principled.
- `db-ivm` is intentionally much simpler.
- We want recursion now, but do not want to pay the full complexity tax upfront.

### What Differential/DBSP are telling us (and what to borrow)

From Differential and DBSP, the durable ideas to keep are:

1. **Recursion should be fixed-point computation over deltas**, not repeated full recomputation.
2. **Semi-naive style propagation** (only newly discovered tuples drive next iteration) is essential.
3. **Strict feedback / convergence discipline** is mandatory to avoid non-termination.
4. **Two notions of progress exist conceptually**:
   - outer progress (incoming transaction/update),
   - inner progress (loop iteration).

The implementation question is whether we must expose both dimensions in the public runtime timestamp model.

### Can we avoid global multidimensional time?

**Yes, as a first-class engineering step**: keep one external time dimension (current `db-ivm` behavior), and model the recursion iteration dimension as *internal operator state*.

Think of this as "local nested time" instead of "global timestamp vectors".

- External graph: unchanged, still versionless from the API perspective.
- Recursive operator internals:
  - own work queue,
  - own iteration counter/depth,
  - own convergence checks.

This gives most of the practical value without changing every operator or stream type.

## Proposed operator shape (first pass)

### Conceptual API

```ts
recursiveFixpoint({
  roots,      // stream of root entities / correlation keys
  edges,      // stream of adjacency edges
  expand,     // one-step expansion function (join-like)
  options: {
    maxDepth?: number,
    cyclePolicy: 'dedupe-node' | 'allow-paths' | 'error',
    deletionMode: 'recompute-affected' | 'support-counts',
  },
})
```

For tree includes, `expand` is typically "follow `parentId -> id` edge one hop".

### Output contract for includes

Emit tuples keyed by child identity, with payload that includes:

- `correlationKey` (root/parent scope key for fan-out),
- `nodeKey` (child key),
- `depth`,
- optional `parentNodeKey` (for deterministic tree reconstruction),
- optional stable order token.

This stays compatible with current includes output routing (`correlationKey` fan-out remains outside graph).

### Compiled pipeline sketch (Option D)

Below is a concrete **pseudo-code sketch** of what compilation could emit for a
recursive include, using current `db-ivm`-style streams and operators.

```ts
// Input collection stream: [nodeKey, nodeRow]
const nodesInput = inputs.cn

// 1) Parent/root keys from already-filtered parent pipeline
// Shape: [correlationKey, { rootNodeKey }]
const parentKeys = parentPipeline.pipe(
  map(([_, parentNsRow]) => {
    const root = parentNsRow.pn
    return [root.id, { rootNodeKey: root.id }] as const
  }),
)

// 2) One shared adjacency stream for recursion
// Shape: [parentId, { nodeKey, node }]
const edgesByParent = nodesInput.pipe(
  map(([nodeKey, node]) => [node.parentId, { nodeKey, node }] as const),
)

// 3) Seed stream (depth 0 or 1, depending on chosen convention)
// Shape: [correlationKey, RecursiveRow]
const seed = parentKeys.pipe(
  map(([correlationKey, { rootNodeKey }]) => [
    correlationKey,
    {
      nodeKey: rootNodeKey,
      parentNodeKey: null,
      depth: 0,
    },
  ] as const),
)

// 4) Recursive fixed-point operator (new in Option D)
// Emits only net-new / net-removed recursive rows incrementally.
const recursiveRows = recursiveFixpoint({
  seed,
  edgesByParent,
  maxDepth, // optional (for syntax compatibility with Option A)
  cyclePolicy: `dedupe-node`, // dedupe by (correlationKey,nodeKey)
  deletionMode: `recompute-affected`, // first implementation
})

// 5) Join recursive rows back to base node rows to project final shape
// Shape: [childNodeKey, [childResult, orderByIndex?, correlationKey]]
const includesChildPipeline = recursiveRows.pipe(
  // pseudocode for lookup/join; real implementation can use join/index operator
  map(([_corr, rr]) => [rr.nodeKey, rr] as const),
  join(nodesInput, `inner`),
  map(([childNodeKey, [rr, nodeRow]]) => [
    childNodeKey,
    [
      {
        ...nodeRow,
        __depth: rr.depth,
        __parentNodeKey: rr.parentNodeKey,
      },
      undefined, // orderBy index slot (kept for compatibility)
      rr.correlationKey,
    ],
  ] as const),
)
```

And then this stream plugs into the existing includes output machinery:

- `pendingChildChanges` accumulation,
- `correlationToParentKeys` fan-out,
- `flushIncludesState` materialization into child collections/arrays.

So Option D changes the **source of child rows**, while preserving the existing
"single graph branch + external fan-out" architecture.

## Internal algorithm sketch (no global multidimensional time)

### State

Per recursive operator instance:

- `edgeIndex`: parentNodeKey -> children
- `reverseEdgeIndex`: childNodeKey -> parents (for deletes)
- `rootsIndex`: active roots
- `reachable`: map `(rootKey, nodeKey) -> state`
  - at minimum: present/not-present, depth
  - for robust deletions: support count / witness set
- `frontierQueue`: pending delta tuples for next expansion wave

### Insert propagation (semi-naive)

1. Ingest root/edge inserts as delta.
2. Seed `frontierQueue` with new reachable facts.
3. Loop until queue empty:
   - pop wave,
   - expand one hop via `edgeIndex`,
   - apply cycle/dedupe policy,
   - emit only net-new tuples,
   - enqueue only newly-added tuples for next wave.

This is standard semi-naive fixed-point iteration inside one operator run.

### Delete propagation: two viable modes

#### Mode 1: recompute-affected (simpler, good first cut)

- On edge/root delete, identify affected roots/subgraph.
- Retract previously emitted tuples for affected scope.
- Recompute fixed point for that affected scope from current base data.

Tradeoff:
- simpler correctness,
- potentially expensive on large deletions.

#### Mode 2: support-counts / witnesses (full incremental)

- Track derivation support per `(root,node)` tuple.
- Inserts increment support and may cross 0 -> positive (emit insert).
- Deletes decrement support and may cross positive -> 0 (emit delete), then cascade.

Tradeoff:
- best incremental behavior,
- more state and complexity (especially for DAGs with many alternative paths).

## Cycle, DAG, and depth semantics

### Cycle policy

Recommended default: `dedupe-node` by `(rootKey,nodeKey)`.

- Guarantees termination on finite graphs.
- Produces one materialized node per root, not one row per path.

Alternative `allow-paths` is much heavier (potential explosion), and should be opt-in.

### Depth handling (the "inject depth per iteration" idea)

Depth can be treated as the operator's internal iteration coordinate:

- `depth=0` at root seed (or `1` at first child hop; pick one and document),
- each expansion increments depth by 1.

This supports:

- optional `maxDepth` stopping criterion (Option A compatibility),
- deterministic breadth-first layering,
- future APIs that expose depth/path metadata.

Important: with dedupe-by-node, keep the minimal depth seen for each `(root,node)`.

## Why this is syntax-compatible with Option A

If we introduce recursive query syntax now, we can compile it in two different ways without API break:

1. **MVP path**: unroll to `maxDepth` nested includes (Option A).
2. **Future path**: compile to `recursiveFixpoint` operator (Option D).

Same user syntax, different backend strategy.

## Integration points in TanStack DB

### IR / builder

Add a recursive include IR form (placeholder naming):

- `RecursiveIncludesSubquery`:
  - base child query,
  - self reference marker,
  - correlation metadata,
  - options (`maxDepth`, cycle policy, etc.).

### Compiler

When recursive IR is detected:

- emit one recursive operator branch in `compileQuery`,
- continue returning child rows with correlation metadata,
- keep select placeholder behavior (as done for includes now).

### Output layer

Largely unchanged core principle:

- still fan out by correlation key in `flushIncludesState`,
- recursive operator only changes what child stream arrives, not where fan-out happens.

## Option E deep dive: reintroduce global time + frontiers

Option E means bringing back the "version + frontier" execution model (as in
`d2ts`) into `db-ivm`, then implementing recursion on top of that.

Why it is worth considering:

- explicit transaction tracking and ordering,
- stronger global progress semantics,
- cleaner foundation for multiple future iterative operators.

### E1: global **single-dimensional** time + frontiers

Use one global version coordinate (transaction epoch), and frontiers to mark
completion of each epoch:

- input data arrives as `(version, delta)`,
- frontier advance means "no more data < frontier",
- all operators become version-aware again.

Recursion can still use a local operator loop internally (like Option D), but
its outputs are tagged with the same outer version.

Sketch:

```ts
const graph = new D2({ initialFrontier: 0 })
const nodes = graph.newInput<NodeRow>()

const parentKeys = compileParent(... ) // stream of [corrKey, root]
const recursiveRows = parentKeys.pipe(
  recursiveFixpoint({ /* same logic as Option D */ }),
)

graph.finalize()

// transaction N
nodes.sendData(42, nodeDelta)
nodes.sendFrontier(43)
graph.run()
```

What E1 brings:

- stable transaction boundaries system-wide,
- better observability/debuggability ("which epoch produced this row"),
- easier consistency rules across multiple inputs.

Cost of E1:

- all streams/operators/messages become versioned again,
- frontier correctness needs to be restored across graph execution,
- substantial migration in `db-ivm` and compiler glue.

### E2: global **multidimensional** time + frontiers (Differential-like)

Use timestamps like `[txn, iter]` (or equivalent lattice tuples), with
antichain frontiers.

This supports explicit iterative scopes:

- entering recursion extends time: `[txn] -> [txn, 0]`,
- feedback increments iteration: `[txn, i] -> [txn, i + 1]`,
- leaving recursion truncates back to `[txn]`.

Sketch (conceptual):

```ts
const recursiveRows = parentKeys.pipe(
  iterate((loop) =>
    loop.pipe(
      expandOneHop(edgesByParent),
      dedupeByNode(),
      consolidate(),
    ),
  ),
)
```

What E2 brings:

- principled semantics for nested iteration and recursion,
- strong alignment with Differential/DBSP theory,
- best long-term substrate for advanced recursive/incremental operators.

Cost of E2:

- largest complexity increase (time lattice + antichain logic everywhere),
- high implementation and maintenance burden,
- likely much slower path to user-visible value.

## Option D vs Option E: what each really brings

| Dimension | Option D (local recursive operator, versionless graph) | Option E1 (global single time + frontiers) | Option E2 (global multidimensional time) |
| --- | --- | --- | --- |
| Primary benefit | Fastest path to recursive includes | Strong transaction semantics | Most general recursive semantics |
| Scope of change | Mostly one operator + compiler wiring | Whole runtime message model | Whole runtime + time lattice model |
| Transaction tracking | Implicit / external to graph | Explicit and native | Explicit and native |
| Recursion semantics | Strong enough for tree/DAG with careful state | Similar to D unless iterate scopes added | First-class iterative scopes |
| Delivery risk | Low-medium | Medium-high | High |
| Performance overhead | Lowest base overhead | Moderate (version/frontier plumbing) | Highest (timestamp lattice machinery) |
| Future extensibility | Good, but local to recursive op | Better global control | Best theoretical headroom |
| Best use case | Ship recursive includes soon | Need explicit epoch correctness now | Need full Differential-like model |

### Practical interpretation

- If the goal is "ship recursive includes for common use cases quickly", **D wins**.
- If transaction-epoch correctness inside IVM is a hard requirement now, **E1 becomes compelling**.
- If we expect many recursive/time-nested operators and need a canonical model, **E2 is architecturally strongest** but expensive.

## Concrete phased plan (A now, D/E decision gate)

### Phase A1 (MVP)

- Implement depth-limited recursive syntax with explicit `maxDepth`.
- Compile by unrolling.
- Land tests for:
  - deep chain,
  - wide tree,
  - subtree move,
  - cycle handling under `maxDepth`.

### Phase D0 (operator spike, behind flag)

- Add internal `recursiveFixpoint` operator with:
  - inserts + updates,
  - delete handling via recompute-affected mode.
- Tree-first semantics (`dedupe-node`, stable keys).
- Benchmark against Option A at moderate depths.

### Phase D1 (full incremental deletes)

- Add support counts / witnesses.
- Expand to robust DAG behavior.
- Add stress tests for high churn and subtree re-parenting.

### Phase D2 (only if needed)

- Revisit whether global multidimensional time/frontiers are necessary.
- Only escalate if concrete workloads show correctness/performance gaps that local iteration cannot close cleanly.

### Phase E0 (parallel design spike)

- Specify minimal version/frontier contract needed for transaction tracking.
- Decide whether E1 alone is enough, or if E2 is actually required.
- Prototype cost estimate:
  - number of operators touched,
  - expected perf/memory delta,
  - migration impact on db compiler/live query code.

### Decision gate: choose D-only vs D+E1 vs E2

Evaluate with concrete workloads:

- high-frequency transactions across multiple inputs,
- recursive subtree churn (insert/delete/move),
- observability/debugging needs by transaction.

Choose:

1. **D-only** if correctness/perf targets are met without global time.
2. **D + E1** if transaction tracking and epoch semantics are required system-wide.
3. **E2** only if E1 cannot satisfy recursive/iterative semantics needed by roadmap.

## Risks and mitigations

1. **Delete complexity in DAGs**
   - Mitigation: start with recompute-affected mode; gate support-count mode later.

2. **State growth**
   - Mitigation: strict dedupe policy by default; expose safeguards (`maxDepth`, optional per-root limits).

3. **Non-termination under permissive path semantics**
   - Mitigation: default `dedupe-node`; explicit opt-in for path semantics with hard limits.

4. **Ordering instability across recursive updates**
   - Mitigation: define deterministic order contract early (e.g., by depth then key, or explicit `orderBy` semantics per level).

5. **Runtime-wide migration risk for Option E**
   - Mitigation: do E0 spike first; quantify exact operator/runtime churn before committing.

6. **Frontier/liveness bugs if global time returns**
   - Mitigation: add invariant checks and dedicated tests for monotonic frontier advancement and quiescence.

7. **Higher steady-state overhead with versioned messages**
   - Mitigation: benchmark E1 against D on representative live-query workloads before deciding.

## Open questions to lock before implementation

1. Node identity semantics for DAGs:
   - one instance per `(root,node)` or per path?
2. Parent-child ordering semantics at each depth.
3. Whether subtree moves must be strongly incremental in v1 of Option D.
4. How much recursion metadata should be exposed (`depth`, `path`, `ancestor`).
5. Hard bounds for safe execution (depth, node-count, iteration-count).
6. If Option E is chosen, should transaction tracking use:
   - single-dimensional epochs only, or
   - multidimensional `[txn, iter]` timestamps?

## References used in this exploration

- Current TanStack DB includes pipeline:
  - `packages/db/src/query/compiler/index.ts`
  - `packages/db/src/query/live/collection-config-builder.ts`
- `d2ts` iterative machinery (pre-simplification reference):
  - `packages/d2ts/src/operators/iterate.ts`
  - `packages/d2ts/src/order.ts`
- DBSP paper (arXiv 2203.16684):
  - abstract and sections 5-6 discuss recursion, fixed points, and nested time dimensions.
