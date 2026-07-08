# RFC: Stabilizing includes / nested materialization

**Status**: draft
**Scope**: bug fixes and internal refactors only — no new public API surface, no behavior changes beyond fixing verified bugs.
**Branch**: `explore-includes-materialization` (contains the verification tests cited below)

## 1. What's happening

The includes system (subquery-in-select, `toArray()`, `materialize()`) has produced a steady
stream of correctness bugs: silently misrouted data, dropped children, stale sort order, broken
adapter reactivity, and permanent loading states. Every claim below was verified against current
`main` with a red/green test (tests live on this branch, in `describe('cluster-verification …')`
blocks appended to existing test files).

| #              | Claim                                                                                                                  | Verified                                                                                                                                                                                                     | Evidence                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| #1454          | Duplicate alias in sibling includes silently misroutes data                                                            | **RED — confirmed, worse than reported**: the `issues` include is fully replaced by tag rows, real issues lost, nested comments empty                                                                        | `packages/db/tests/query/includes.test.ts` (cluster-verification, claim A) |
| #1444          | `orderBy` in an include ignored after optimistic update on the child collection                                        | **RED — confirmed**: child values propagate, re-sort does not                                                                                                                                                | same file, claim B                                                         |
| #1510          | Live query stuck loading forever when a subquery's inner collection is cold on-demand and the outer produces zero rows | **RED — confirmed**: `allCollectionsReady()` never true because per-row lazy `loadSubset` never fires                                                                                                        | `packages/db/tests/query/includes-lazy-loading.test.ts` (#1510 block)      |
| #1533          | Progressive sync: nested `toArray` children skip the fast-path snapshot                                                | **RED — confirmed**: lazy alias ⇒ `includeInitialState: false` ⇒ the only `requestSnapshot` fires per parent row, after the progressive buffering window closed                                              | same file, #1533 block (paired passing baseline for the direct query)      |
| #1571 (part 1) | Solid: `toArray` include updates never reach the rendered `data` store                                                 | **RED — confirmed, stronger than reported**: even an untracked re-read of `data` is stale; the `state` map and underlying collection row do update                                                           | `packages/solid-db/tests/useLiveQuery.test.tsx` (#1571 block)              |
| #1571 (part 2) | Initially-empty include starts `null` and never becomes reactive                                                       | **Not reproduced**: field is an empty child `Collection` from first render and populates on insert (caveat: `Collection` instances aren't Solid-reactive by design)                                          | same file                                                                  |
| #1495          | Sync-confirmed child update misclassified as insert, crashes duplicate-key diagnostics                                 | **Fixed on main** by merged #1600 (`has()` reclassification + `config.utils` guard)                                                                                                                          | `includes.test.ts`, claim C (green)                                        |
| #1501          | 3-level nested `toArray` drops children when correlation keys overlap across parent groups                             | **Fixed on main** by merged #1607 (fan-out routing + snapshot reseeding)                                                                                                                                     | `includes.test.ts`, claim D (green control)                                |
| #1488          | On-demand observer reuse loses row ownership; cleanup deletes rows still in use                                        | **Not reproducible on main**: the early-return shape exists, but atomic observer+ownership cleanup and ownership re-registration on `subscribers:change` compensate; likely fixed since the reported version | `packages/query-db-collection/tests/query.test.ts` (#1488 block, green)    |

### Why these keep happening

The bugs are not independent. The includes system compiles each include into its own child D2
pipeline (sound), but then reconstructs include semantics in a ~2,300-line imperative output layer
(`packages/db/src/query/live/collection-config-builder.ts`) using alias maps, child collection
registries, correlation routing indexes, pending-change buffers, and in-place parent-row mutation.
Correctness rests on identities that are only implicit:

1. **An alias is not a source identity.** Sibling subqueries legitimately reuse lexical names, but
   the compiler flattens all includes aliases into one namespace, so `{ i: issues }` and
   `{ i: tags }` share one D2 input (#1454).
2. **A correlation key is not a parent identity.** Multiple parents can subscribe to the same
   correlated child set; a destructively-drained shared buffer can't represent that fan-out
   (#1501/#1457 — patched by #1607, but the shared-state design remains).
3. **Differential multiplicity is not CRUD intent.** A `(-1,+1)` pair must become one atomic
   replacement including its order metadata. Today "insert vs update" is decided per call site —
   three near-copies of the accumulator exist (parent/child/nested), and the child copy retained a
   stale `orderByIndex` (#1444). The landed #1600 fix decides by checking `collection.has(key)`
   mid-flush, which works but keeps classification dependent on whatever state exists at flush time.
4. **Object identity is not result revision.** `flushIncludesState` mutates parent rows in place
   and force-emits through `changesManager.emitEvents(events, true)` to defeat the collection's own
   `deepEquals` suppression. React's version-bump tolerates this; Solid's `reconcile` does not
   (#1571), and each future adapter needs its own workaround.
5. **Source-collection readiness is not query readiness.** Readiness is a global boolean over all
   involved collections; lazy children that were never demanded (#1510) or progressive children
   whose fast-path window is timing-dependent (#1533) fall through it.

## 2. Design direction (all internal)

Five internal principles, each of which converts a bug class into an invariant. No public API is
added or changed.

- **P1 — Opaque plan identities.** The compiler assigns every include node and source a generated
  ID; user aliases are resolved lexically per subquery scope and never used as runtime keys.
  Invariant: _alpha-renaming any subquery alias cannot change results._
- **P2 — One transition reducer.** A single reduction boundary turns a batch of weighted D2 tuples
  into net per-key transitions `{key, before?, after?, orderBefore?, orderAfter?}`, applied via two
  idempotent ops (`set(key, after, orderAfter)` / `delete(key)`). Value and order tuple live in the
  same versioned entry, so a replacement updates both atomically. Used by root live queries and all
  include levels. Invariant: _no code path decides insert-vs-update by inspecting store state
  mid-batch._
- **P3 — Correlated relation operator.** Replace the shared nested buffers / routing indexes /
  cumulative snapshots with one reusable internal structure: buckets keyed by
  `(includeNodeId, correlationTuple)` holding an ordered keyed relation, plus subscriber edges.
  Child deltas update a bucket once and fan out to every subscribed parent; a newly subscribed
  parent receives the bucket snapshot; removing a parent removes only its edge. Nesting recurses
  through the same operator — depth 3 is not a separate code path from depth 1. Internal child
  `Collection`s (with their `gcTime: 0` and `config.utils` hazards) shrink to this lightweight
  relation, keeping a `Collection` facade only where the API already promises one (bare
  subquery-in-select).
- **P4 — Publication by replacement.** When an include value changes, publish a shallow-copied
  parent row with a new include array/value (structural sharing for unchanged fields) through the
  normal update path. Reference change ⇔ value change, for every adapter. Deletes the force-emit
  hack, the Solid clone shim, and the in-place/`deepEquals` tension.
- **P5 — Demand-relative readiness.** Internally, a live query is ready when every _currently
  demanded_ source subset has settled its initial snapshot. An empty outer demands nothing from the
  child, so the child is vacuously ready (#1510). A nested progressive child requests its
  correlated subset through the same snapshot path a direct query uses (#1533). This is a
  reorganization of existing readiness bookkeeping, not a new status API.

Explicitly **out of scope** (would be new features): a `query.explain()` API, public demand/lease
APIs, per-include loading-status fields, new materialization modes or helpers. Dev-mode internal
assertions (throw on duplicate routing registration, orphaned buffer entries, child writes with no
registered parent) are in scope — today's failure mode is silent data corruption.

## 3. Proposed PR series

Ordered so each PR is independently landable, keeps the public API frozen, and is gated by tests.
PRs 1–5 fix the verified-RED bugs; PRs 6–10 remove the bug factory.

### Phase 0 — stabilization (fix the verified bugs)

1. **Scoped includes inputs (fixes #1454).** Land/adapt open PR #1455: each includes subquery gets
   its own D2 graph input and subscription instead of the flattened alias namespace. Its
   `__inc_N_alias` key mangling is acceptable as stabilization and is superseded by PR 6.
   Gate: cluster-verification claim A goes green.
2. **Atomic order-index replacement (fixes #1444).** Land open PR #1496: apply the parent
   accumulator's `orderByIndex`-update logic to the child and nested accumulators. Superseded by
   PR 7, which deletes all three copies. Gate: claim B green.
3. **Readiness for undemanded lazy children (fixes #1510).** Land open PR #1510: skip lazy aliases
   in `allCollectionsReady`; the `isLoadingSubset` gate still holds the query while per-row loads
   are in flight. Gate: #1510 verification tests green.
4. **Solid publication shim (fixes #1571 part 1).** Land open PR #1604 (clone rows in
   `syncDataFromCollection` before `reconcile`). Explicitly labeled a temporary
   publication-boundary shim, removed by PR 9. Gate: #1571 part-1 test green.
5. **Progressive fast path for nested children (fixes #1533).** When the child collection is in
   progressive mode, request the correlated snapshot at subscription setup (or on first parent-key
   batch) through the same `requestSnapshot` path a direct query uses, instead of relying on the
   per-row lazy tap that fires after the buffering window closes
   (`packages/db/src/query/live/collection-subscriber.ts:116-119`,
   `packages/db/src/query/compiler/index.ts:544-578`). Needs a small design note: the electric
   adapter's snapshot window (`isBufferingInitialSync`) vs late `loadSubset`. Gate: #1533
   verification test green, baseline stays green.

### Phase 1 — lock in behavior

6. **Recompute-oracle property harness (test-only).** Model-based tests: random schemas (include
   depth 1–4, overlapping correlation keys, duplicate aliases in separate scopes), random op
   sequences (optimistic then sync-confirm, late parents/children, reorders, empty outers), and
   after each op assert `incremental(query, history) === recompute(query, state)`. Metamorphic
   invariants: alpha-renaming aliases, reordering sibling includes, and adding an unrelated sibling
   include are all no-ops; optimistic+confirm converges to confirmed-only. `@fast-check/vitest` is
   already a dev dependency. This is the safety net for everything below; it also retroactively
   covers the classes of #1457/#1501/#1495.

### Phase 2 — identities and one reducer (internal refactor)

7. **Opaque node/source IDs + shared transition reducer.**
   - Compiler assigns generated IDs to include nodes and sources; all runtime maps
     (`collectionByAlias`, routing, lazy-target resolution) key by ID; lexical aliases resolve per
     scope. Replaces PR 1's mangling. Also replace `computeRoutingKey`'s
     `JSON.stringify([correlationKey, parentContext])` with one canonical structural-key encoder.
   - Extract the single per-key transition reducer (P2) and route parent, child, and nested outputs
     through it; delete the three accumulator copies and the `has(key)`-based reclassification from
     #1600 (its tests remain and must stay green).
   - Gate: oracle harness + alpha-renaming property + entire existing includes suite.

### Phase 3 — correlated relation operator

8. **`CorrelatedRelation` replaces nested buffers/routing (P3).** Introduce the operator with
   bucket state, subscriber edges, snapshot-on-subscribe, and non-destructive fan-out. Run in
   shadow mode first (tests compare it against the legacy materializer over the oracle workloads),
   then swap `nestedSetups` / `drainNestedBuffers` / `updateRoutingIndex` /
   `createPerEntryIncludesStates` over to it and delete the legacy path. Internal child state
   becomes the lightweight relation; the `Collection` facade remains only for bare
   subquery-in-select includes. Removes the `gcTime: 0` workaround and the internal-collection
   `config.utils` hazard class.

### Phase 4 — publication and readiness

9. **Copy-on-write publication (P4, fixes #1571 structurally).** Shallow-copy parent rows on
   include change with structural sharing; publish through the normal update path; delete
   `emitEvents(events, true)` and the hand-cloned prev/next; remove the Solid shim from PR 4 and
   verify the cross-adapter conformance suite (`packages/solid-db/tests/conformance.test.tsx` et
   al.) passes for React/Solid/Vue/etc. Perf gate: `scripts/perf-bench.ts` A/B before/after —
   rows are already double-cloned today for the forced event, so this is likely neutral-to-better.
10. **Demand-relative readiness (P5, subsumes PR 3, fixes #1533's class).** Consolidate
    `allCollectionsReady`, lazy-alias exclusions, `isLoadingSubset`, and progressive snapshot
    delivery behind one internal demand model: readiness = all currently-demanded subsets settled.
    PR 3's exclusion list and PR 5's special-casing collapse into it.

### Ongoing

- **Dev-mode invariant assertions** land opportunistically inside PRs 7–9 (duplicate routing
  registration, orphaned buckets at flush end, alias-keyed runtime lookups, unbalanced weighted
  batches). Each converts a silent-corruption mode into a thrown error in development builds.

## 4. Non-goals / rejected approaches

- No new public APIs (explain, loading-status fields, demand/lease surface, new helpers).
- No further alias mangling beyond PR 1's stopgap, no additional per-depth buffers or flush
  sub-passes, no per-adapter cloning beyond the temporary PR 4 shim, no growing the
  readiness-exclusion list beyond PR 3's stopgap. Each of these closes one issue while making the
  state machine harder to reason about — the phase 2–4 refactors exist to delete them.

## 5. Risks

- **PR 8 is the big one.** Shadow mode + the oracle harness are the mitigation; it should not land
  before PR 6.
- **PR 9 changes result-object identity guarantees** (rows are replaced, not mutated). This is the
  documented expectation adapters already assume; the conformance suite plus the react/solid/vue
  adapter tests are the gate. Any user code depending on in-place mutation of live-query rows was
  already broken by `deepEquals` suppression semantics.
- **PR 5 touches the electric adapter's sync window**; it needs an e2e test in
  `packages/electric-db-collection/e2e` (PR #1532's draft e2e test is a starting point).

## Appendix: relationship to open PRs

| Open PR                                 | Disposition                                     |
| --------------------------------------- | ----------------------------------------------- |
| #1455 (duplicate alias)                 | Land as PR 1; superseded by PR 7's identities   |
| #1496 (orderBy after optimistic update) | Land as PR 2; superseded by PR 7's reducer      |
| #1510 (readiness)                       | Land as PR 3; superseded by PR 10               |
| #1604 (solid clone)                     | Land as PR 4 as a labeled shim; removed by PR 9 |
| #1532 (progressive nested test)         | Fold its tests into PR 5                        |
| #1607, #1600, #1580                     | Already merged; their tests remain as gates     |

Issue #1488 (observer-reuse ownership) did not reproduce on main and is excluded; recommend asking
the reporter to re-verify against current `@tanstack/query-db-collection` and closing if stale.
Issue #1505 is closed; its underlying concern (include fields transiently unmaterialized, types
don't admit it) is addressed by PR 9's always-attached include values.
