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

## Concrete phased plan (A now, D in parallel)

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

## Risks and mitigations

1. **Delete complexity in DAGs**
   - Mitigation: start with recompute-affected mode; gate support-count mode later.

2. **State growth**
   - Mitigation: strict dedupe policy by default; expose safeguards (`maxDepth`, optional per-root limits).

3. **Non-termination under permissive path semantics**
   - Mitigation: default `dedupe-node`; explicit opt-in for path semantics with hard limits.

4. **Ordering instability across recursive updates**
   - Mitigation: define deterministic order contract early (e.g., by depth then key, or explicit `orderBy` semantics per level).

## Open questions to lock before implementation

1. Node identity semantics for DAGs:
   - one instance per `(root,node)` or per path?
2. Parent-child ordering semantics at each depth.
3. Whether subtree moves must be strongly incremental in v1 of Option D.
4. How much recursion metadata should be exposed (`depth`, `path`, `ancestor`).
5. Hard bounds for safe execution (depth, node-count, iteration-count).

## References used in this exploration

- Current TanStack DB includes pipeline:
  - `packages/db/src/query/compiler/index.ts`
  - `packages/db/src/query/live/collection-config-builder.ts`
- `d2ts` iterative machinery (pre-simplification reference):
  - `packages/d2ts/src/operators/iterate.ts`
  - `packages/d2ts/src/order.ts`
- DBSP paper (arXiv 2203.16684):
  - abstract and sections 5-6 discuss recursion, fixed points, and nested time dimensions.
