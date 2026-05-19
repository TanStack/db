# `unionAll` Query Builder Refactor Plan

## Goal

Replace the public multi-source `from({ ... })` API with an explicit
`unionAll` start method on the query builder.

The current multi-source `from` behavior is conceptually a `UNION ALL`, not a
SQL `FROM a, b` cross join. Making the operation explicit should make the query
API easier to explain while preserving the runtime and type-system work already
done for unioned live queries.

## Desired API Shape

Phase 1 adds object syntax:

```ts
q.unionAll({
  message: messages,
  toolCall: toolCalls,
}).orderBy(({ message, toolCall }) =>
  coalesce(message.timestamp, toolCall.timestamp),
)
```

Phase 2 can add query-list syntax:

```ts
q.unionAll(
  q.from({ message: messages }).where(({ message }) => eq(message.userId, 1)),
  q.from({ message: messages }).where(({ message }) =>
    eq(message.status, `active`),
  ),
).orderBy(({ message }) => message.timestamp)
```

The object form is source-level union. The list form is result-level union.

## Phase 1: Object Syntax

### Semantics

`q.unionAll({ ...sources })` should behave like the current multi-source
`from({ ...sources })` implementation:

- Each source row enters the query as a namespaced row under its source alias.
- Exactly one union source alias is present for each input row.
- Missing union source aliases evaluate to `undefined`.
- `where`, `select`, `orderBy`, `groupBy`, `having`, joins, and includes run
  after the source streams are unioned.
- If no `select()` is used, the result type is an exclusive/discriminated union:

```ts
type Result =
  | { message: Message; toolCall?: undefined }
  | { message?: undefined; toolCall: ToolCall }
```

If a source is a subquery, the source alias contains the subquery result. This
matches normal `from({ alias: subquery })` behavior.

### Key Semantics

Object syntax should continue prefixing output keys by source alias:

```ts
message:string:message-1
toolCall:string:tool-call-1
```

The existing branch key encoding should be preserved so values like numeric `1`
and string `"1"` cannot collide.

### Implementation Outline

1. Add a `unionAll<TSource extends Source>(source: TSource)` method to
   `BaseQueryBuilder`.
2. Expose `unionAll` on `InitialQueryBuilder`, alongside `from`.
3. Move the current multi-source context behavior out of `ContextFromSource`
   into a dedicated `ContextFromUnionSource<TSource>` helper.
4. Make `ContextFromSource<TSource>` represent only single-source `from`.
5. Make `from()` reject multi-source objects at runtime again by using
   `_createRefForSource(source, "from clause")`.
6. Have `unionAll({ ... })` use `_createRefsForSource(source, "unionAll")` and
   create the existing `UnionFrom` IR node.
7. Rename comments/docs/tests from "multi-source from" to "`unionAll`" where
   they describe the public API.

The compiler can keep using `UnionFrom` internally. That IR name is acceptable
because it describes the implementation; we do not need to expose it as public
API.

### Tests

Update the current multi-source query tests to use `q.unionAll({ ... })`.

Add focused coverage that:

- `q.from({ a, b })` is rejected at runtime.
- The initial builder exposes both `from` and `unionAll`.
- `q.unionAll({ message, toolCall })` preserves the existing exclusive union
  result type when no `select()` is used.
- Object syntax still supports collection sources, subquery sources, joins,
  includes, ordering, lazy loading, and nested include materialization.
- Object syntax still prefixes keys by alias.

## Phase 2: Query-List Syntax

### Semantics

`q.unionAll(queryA, queryB, ...)` should union the already-built result rows from
each branch query.

Each branch query should run with normal query semantics before entering the
union:

- A single-source query with no `select()` unwraps to its row type.
- A query with joins and no `select()` returns its namespaced joined row shape.
- A query with `select()` returns its selected result shape.
- A query whose result has two namespaces keeps both namespaces when entering
  the union.

This means namespace preservation is explicit:

```ts
// Unwrapped row results
q.unionAll(
  q.from({ message: messages }),
  q.from({ toolCall: toolCalls }),
)
```

```ts
// Namespaced results
q.unionAll({
  message: messages,
  toolCall: toolCalls,
})
```

For query-list syntax, TypeScript should allow different branch row types. The
result should be the union of the branch result types rather than requiring SQL
style column compatibility.

### Key Semantics

Query-list syntax should prefix output keys by branch index, not alias:

```ts
0:string:message-1
1:string:message-1
```

This is necessary for cases where the same source row appears in more than one
branch. `UNION ALL` should preserve both rows.

### Implementation Options

The current `UnionFrom` model stores sources by alias in several places. That is
fine for object syntax, but query-list syntax needs branch identity that is
separate from alias.

Likely implementation:

1. Add a new IR node for result-level unions, for example `UnionAll`.
2. Store an ordered array of branch `QueryIR`s.
3. Compile each branch query independently to its final `$selected` output.
4. Concatenate branch output streams.
5. Prefix each branch key with its branch index plus the existing encoded key.
6. Set the outer `$selected` to each branch's result row.

This avoids special casing namespace unwrapping. Branches simply produce the
same result shape they would produce if executed on their own.

### Type Outline

Add a query-list overload such as:

```ts
unionAll<TBranches extends readonly [QueryBuilder<any>, ...QueryBuilder<any>[]]>(
  ...branches: TBranches
): QueryBuilder<ContextFromUnionBranches<TBranches>>
```

`ContextFromUnionBranches<TBranches>` should:

- Set the query result to `QueryResult<TBranches[number]>`.
- Mark the query as having a result, because the union output is already the
  branch result shape.
- Avoid exposing branch source refs to downstream callbacks unless we model a
  meaningful merged schema.

Follow-up design decision: whether downstream `where`/`orderBy` callbacks for
query-list unions receive refs for a common object shape, a union-shaped row, or
only `$selected`-style selected refs. This should be resolved before
implementation because it affects DX and type complexity.

### Tests

Add coverage for:

- Unioning two single-source queries with compatible row shapes.
- Unioning two single-source queries from the same collection where a row appears
  in both branches and is emitted twice with different branch-index-prefixed
  keys.
- Unioning different row types and preserving a TypeScript union result.
- Unioning a branch query with joins and preserving the joined namespace shape.
- Unioning branch queries with explicit `select()` projections.
- Ordering and filtering after the result-level union, once callback semantics
  are finalized.

## Migration Notes

Phase 1 is a public API rename/refactor:

```ts
// Before
q.from({
  message: messages,
  toolCall: toolCalls,
})
```

```ts
// After
q.unionAll({
  message: messages,
  toolCall: toolCalls,
})
```

Single-source `from({ message: messages })` remains unchanged.

Phase 2 should be additive and can ship separately.
