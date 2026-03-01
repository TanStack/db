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

## Option space

### Option A: Depth-limited unrolling (MVP-friendly)

Idea:
- Introduce recursive syntax, but require `maxDepth`.
- Compile by unrolling into N nested includes nodes.

Pros:
- Reuses almost all current implementation.
- Predictable complexity and easy testing.

Cons:
- Not true recursion (cutoff behavior).
- Query/IR grows with depth.
- Not ideal for unknown depth trees.

### Option B: Per-node dynamic child query instances

Idea:
- At runtime create child query/subscription per discovered node.

Pros:
- Easy to reason about.

Cons:
- Violates performance goal (effectively N queries/subscriptions).
- High memory/loadSubset pressure on large trees.
- Hard to optimize globally.

Conclusion: likely reject.

### Option C: Shared recursive edge stream + recursive fan-out state (recommended medium-term)

Idea:
- Compile a recursive declaration into one shared child/edge stream (same "one branch" principle).
- Maintain recursive adjacency/materialization state outside query graph:
  - `childrenByParentKey`,
  - reverse links for impacted-ancestor propagation,
  - per-parent child Collection/array materialization.
- Recursively attach children using the same stream/state, not new query branches.

Pros:
- Preserves core includes performance model.
- Supports unbounded depth.
- Keeps incremental/reactive behavior centralized in output layer.

Cons:
- Non-trivial runtime/state-engine work.
- Needs explicit cycle policy and update semantics.

### Option D: New query-graph recursive operator (transitive closure/fixpoint)

Idea:
- Add dedicated incremental operator in `@tanstack/db-ivm` for recursive traversal.

Pros:
- Most declarative and potentially most powerful long-term.

Cons:
- Highest implementation complexity/risk.
- More invasive engine work before shipping user value.

## Recommended staged plan

### Phase 0: API and semantics RFC

Decide:
- allowed graph shape (tree only vs DAG),
- cycle behavior (error, truncate, or dedupe by node key),
- ordering/limit semantics (`orderBy/limit` per parent at each depth),
- identity semantics (shared node object across paths vs per-path copy),
- whether recursion requires stable correlation key (likely yes).

### Phase 1: Ship depth-limited recursion (Option A)

- Good for early user feedback and type-system validation.
- Keeps current architecture almost unchanged.
- Enables concrete UX/API iteration (`withQuery` vs dedicated `recursiveInclude(...)` API).

### Phase 2: Build shared recursive materializer (Option C)

- Add a recursive includes IR node that represents a fixed-point/self call.
- Compile one child branch per declaration.
- Extend output-layer state machine to dynamic-depth traversal and impacted-ancestor propagation.
- Preserve existing non-recursive includes behavior as-is.

### Phase 3 (optional/long-term): evaluate graph-level operator (Option D)

- If runtime-layer complexity or performance ceilings appear, move recursion core into IVM.

## Open questions to resolve early

1. **Cycle policy**: What should happen on `A -> B -> A`?
2. **DAG duplication**: If node `X` is reachable from two parents, share instance or duplicate per path?
3. **Move semantics**: Parent change (`parentId` update) should re-home full subtree incrementally.
4. **Result keying**: Need robust key serialization for correlation values.
5. **Interplay with `toArray`**: re-emit boundaries and batching strategy for deep updates.
6. **Parent-referencing child filters**: align recursion design with parent-filtering includes work.

## Practical next step

Build a small RFC/POC on top of this branch with:

- API sketch (including TypeScript inference expectations),
- Phase-1 depth-limited prototype (`maxDepth`),
- benchmark scenarios:
  - deep chain,
  - wide tree,
  - subtree move,
  - frequent leaf insert/delete.

That gives fast signal on ergonomics and correctness before committing to full fixed-point execution.
