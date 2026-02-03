# Hierarchical Projections Implementation Plan

Source RFC: hierarchical-projections-rfc.md (lines 1-1938)
Status: draft plan

## Goals

- Allow subqueries in select() that return ChildCollection<T>.
- Extract a single parent-child join key from child WHERE.
- Compile child branches as parallel D2 outputs (not N+1).
- Support per-parent ordering and limits.
- Support nested (multi-level) child collections.
- Disallow child collection fields in parent WHERE/HAVING.

## Non-goals (v1)

- asArray() / asMap() projection of child data into parent rows.
- Composite join keys and complex join expressions.
- Server-side rendering of child collections.

## Confirmed decisions

- ChildCollection<T> will be exported as a public API type.
- Add new test files for hierarchical projections (not reuse existing harness).
- Child joins are deferred to a post-v1 phase (see Post-v1 section).
- Plan file location is repo root (this file).

## Testing infrastructure (existing)
- Test runner: Vitest (see packages/db/vite.config.ts).
- Default test dir: packages/db/tests (configured in vitest test.dir).
- Runtime tests: *.test.ts under packages/db/tests (jsdom env).
- Type tests: *.test-d.ts under packages/db/tests using expectTypeOf.
- Shared helpers: packages/db/tests/utils.ts and tests/test-setup.ts.
- Prefer colocating new hierarchical-projections tests under
  packages/db/tests/query/ (new files).

## Stage 0: Foundation and IR plumbing

Objective: establish types, IR nodes, and error types without behavior changes.

Scope

- Types:
  - Add ChildCollection<T> brand type.
  - Extend SelectValue and ResultTypeFromSelect to handle BaseQueryBuilder.
- IR:
  - Add SubQuerySelectRef and include in isExpressionLike().
- Errors:
  - MissingJoinKeyError, InvalidJoinExpressionError,
    ChildCollectionAccessError, SubQueryMustHaveFromClauseError,
    PerParentOrderByRequiresPreSelectError.

Deliverables

- Type changes compile.
- IR nodes exist and are recognized by expression checks.
- Errors exported for use by builder/compiler.

Exit criteria

- Type-only tests or typecheck pass.

## Stage 1: ChildCollection runtime and basic includes

Objective: basic child collections without orderBy/limit/aggregates/child joins.

Scope

- Builder:
  - Detect BaseQueryBuilder in select before isPlainObject.
  - Emit SubQuerySelectRef and metadata extraction for join key.
- Compiler:
  - Extract join key from original child WHERE (eq parent-child).
  - Strip join predicate from child WHERE.
  - Ensure join key is included in child SELECT (hidden field if needed).
  - Add preSelectPipeline to CompilationResult when child collections exist.
- Live query:
  - Defer graph.finalize until all outputs are wired.
  - Add ChildCollectionManager and fan-out wiring.
  - Cleanup child collections on parent delete.
- Validation:
  - Track child fields from select and reject in parent WHERE/HAVING.

Deliverables

- Basic include works: parent select returns ChildCollection handle.
- Child collection updates on insert/update/delete.
- Parent delete removes child collection.

Tests

- Query with subquery select and simple eq join key.
- Join key missing throws MissingJoinKeyError.
- Child query missing FROM throws SubQueryMustHaveFromClauseError.
- Child field usage in parent WHERE/HAVING throws ChildCollectionAccessError.
  (Add in packages/db/tests/query/hierarchical-projections.test.ts)

Exit criteria

- All tests green for basic includes.

## Stage 2: Per-parent orderBy, limit, offset

Objective: enable per-parent ordering and pagination using groupedOrderBy.

Scope

- Use child preSelectPipeline to evaluate orderBy expressions.
- Mirror processOrderBy semantics (replaceAggregatesByRefs,
  buildCompareOptions, makeComparator).
- groupedOrderByWithFractionalIndex for per-parent ordering/limit/offset.
- Map grouped output to [parentKey, [childKey, selectedRow, index]].

Deliverables

- Child collections ordered independently per parent.
- limit/offset applied per parent, not globally.

Tests

- Two parents with interleaved child inserts maintain independent order.
- limit/offset edge cases (0, 1, undefined).
- Mixed orderBy direction and nulls behavior matches normal query.
  (Extend packages/db/tests/query/hierarchical-projections-order-by.test.ts)

Exit criteria

- OrderBy/limit parity with normal queries.

## Stage 3: Aggregates and $selected references in child orderBy

Objective: allow child orderBy expressions that reference aggregates.

Scope

- Ensure replaceAggregatesByRefs and $selected handling works for child.
- Validate orderBy expressions compile against namespaced rows with $selected.
- Ensure auto-added join key does not pollute aggregates or select outputs.

Deliverables

- orderBy on aggregate expression works within child query.

Tests

- Child query with groupBy + aggregate select and orderBy aggregate.
- orderBy referencing $selected alias.
  (Add in packages/db/tests/query/hierarchical-projections-aggregates.test.ts)

Exit criteria

- Aggregate ordering behaves like normal queries.

## Stage 4: Multi-level child collections

Objective: recursive child collections (grandchildren, etc).

Scope

- Track nested child metadata in builder.
- Recursively compile child branches using child preSelectPipeline.
- Cleanup nested child collections on parent delete.

Deliverables

- Parent -> child -> grandchild works with fan-out.

Tests

- 2-level nesting with inserts/deletes at each level.
- Parent removal cleans up child and grandchild collections.
  (Add in packages/db/tests/query/hierarchical-projections-nested.test.ts)

Exit criteria

- Multi-level includes behave consistently.

## Stage 5: Hardening, docs, and examples

Objective: stabilize UX and document usage.

Scope

- Add docs/examples for React usage and nested patterns.
- Add error message guidance and troubleshooting.
- Performance sanity checks on large parent sets.

Deliverables

- Documentation and example updates.
- Any final refactors to simplify code paths.

Exit criteria

- Docs updated and reviewed.

## Cross-cutting constraints and risk notes

- Keep join key extraction on original query (pre-optimization).
- Ensure join key field is available post-select for child branches.
- Avoid leaking hidden join key fields to users.
- Preserve type safety (avoid any).
- Defer graph finalization until all outputs are wired.

## Post-v1: Child queries with joins (deferred)

Objective: allow child subqueries that join additional collections.

Scope

- Expand join key extraction to handle child alias sets from joins.
- Ensure child compilation supports multi-source aliases.
- Validate join key only references one parent alias and one child alias.

Deliverables

- Child query with join compiles and runs.

Tests

- Child query with join and parent join key in WHERE.
- Invalid join expression throws InvalidJoinExpressionError.

Exit criteria

- Child joins work without regressions.

## Open questions / blockers

- None currently. Add here if new decisions are needed.
