# Multi-Source `from` Plan

## Goal

Allow a query to read from multiple independent sources in a single `from`
clause and produce one live collection without requiring a join:

```ts
const query = createLiveQueryCollection((q) =>
  q
    .from({
      message: messagesCollection,
      toolCall: toolCallsCollection,
    })
    .orderBy(({ message, toolCall }) =>
      coalesce(message.timestamp, toolCall.timestamp),
      `asc`,
    ),
)
```

Conceptually this is closer to `UNION ALL` than to a join. Each output row
comes from exactly one source alias.

For the initial version, prioritize preserving a discriminated/exclusive result
type when no `select()` is used:

```ts
type Result =
  | { message: Message; toolCall?: undefined }
  | { message?: undefined; toolCall: ToolCall }
```

Per-source filtering or shaping should be done with subqueries:

```ts
const visibleMessages = q
  .from({ message: messagesCollection })
  .where(({ message }) => eq(message.visible, true))

const query = createLiveQueryCollection((q) =>
  q.from({
    message: visibleMessages,
    toolCall: toolCallsCollection,
  }),
)
```

This keeps multi-source `from` focused on combining already-shaped sources and
reuses the existing subquery machinery.

## Non-Goals For The First Pass

- Do not add a separate `selectBySource` API.
- Do not support multi-source inputs inside a single `join({ ... })` call.
- Do not add a large amount of type machinery solely to preserve correlated
  discriminated unions through arbitrary `select()` projections. Preserve the
  best DX that is practical without making the type system fragile.
- Do not optimize per-branch lazy `orderBy + limit` loading initially unless it
  falls out naturally.

## Semantics

Multi-source `from` should behave as a concatenation of branch streams:

- Each source row becomes a namespaced row containing only that alias.
- Missing source aliases evaluate to `undefined`.
- `where`, `fn.where`, `select`, `fn.select`, `orderBy`, `groupBy`, and
  `having` run after the branch streams have been combined.
- Result keys must be namespaced by source alias to avoid collisions, for
  example `${alias}:${sourceKey}` or a structured serialized tuple.
- The operation is multiset union / concat semantics by default. Existing
  `.distinct()` can be used where deduplication by selected value is wanted.

Example runtime namespaced rows:

```ts
// Message branch
{ message: messageRow }

// Tool call branch
{ toolCall: toolCallRow }
```

## IR Design

Add an explicit union source node rather than overloading joins:

```ts
export type From = CollectionRef | QueryRef | UnionFrom

export interface UnionFrom {
  type: `unionFrom`
  sources: Array<CollectionRef | QueryRef>
}
```

Keeping a distinct IR node makes branch-specific handling obvious in the
compiler, optimizer, alias validation, and helper utilities.

## Builder API

Relax `from()` so it accepts multiple source keys, while keeping `join()` as a
single-source API.

Implementation shape:

- Split `_createRefForSource` into:
  - one helper for a single source, used by `join()`
  - one helper for all sources, used by `from()`
- `from({ one: collection })` can keep producing the existing single `From` IR
  for minimal churn.
- `from({ a, b })` should produce `UnionFrom`.
- Empty objects and invalid source values should keep good runtime errors.
- Duplicate alias issues mostly remain impossible within one object, but alias
  validation still needs to handle nested subqueries.

## Type Design

Extend `Context` with enough information to distinguish ordinary single-source
queries from multi-source queries:

```ts
interface Context {
  baseSchema: ContextSchema
  schema: ContextSchema
  fromSourceName: string
  fromSourceNames?: readonly string[]
  hasUnionFrom?: true
  // existing fields...
}
```

For `from({ a, b })`, set:

- `baseSchema`: `{ a: A; b: B }`
- `schema`: refs visible to callbacks, likely `{ a: A | undefined; b: B | undefined }`
- `fromSourceNames`: `[`a`, `b`]`
- `hasUnionFrom`: `true`

The callback refs should allow expressions like:

```ts
orderBy(({ message, toolCall }) =>
  coalesce(message.timestamp, toolCall.timestamp),
)
```

That means branch refs should behave similarly to nullable join refs for
property access and selected field extraction.

For `GetResult`:

- If `hasResult` is true, keep returning the selected result type.
- Else if `hasUnionFrom` is true, return a union over the source aliases.
- Else preserve existing join and single-source behavior.

Potential helper:

```ts
type UnionFromResult<TSchema extends ContextSchema> = {
  [K in keyof TSchema]: Prettify<
    {
      [P in K]: NonNullable<TSchema[P]>
    } & {
      [P in Exclude<keyof TSchema, K>]?: undefined
    }
  >
}[keyof TSchema]
```

The exact helper may need to account for virtual props and existing `Ref`
nullable extraction rules.

## Compiler Design

The compiler currently starts with one `mainSource` and one `mainInput`. Add a
branch for `UnionFrom`:

1. Process each source with a generalized `processSource`.
2. For each branch:
   - resolve input stream and collection id
   - wrap rows as `{ [alias]: row }`
   - prefix the key with the alias
3. Concatenate branch streams with `@tanstack/db-ivm` `concat`.
4. Continue with existing `where`, includes extraction, select, group by,
   distinct, order by, and output steps.

The existing `concat` operator in `db-ivm` should be enough for the stream merge.

Important details:

- `CompilationResult.collectionId` currently represents the main collection.
  For union sources, either choose a primary branch only for legacy fields, or
  add metadata that tells consumers there is no single main collection.
- `mainSource` is used for default result selection, includes routing, group-by
  correlation, and order-by optimization. Union sources need a different path
  for default result selection.
- The final no-select `$selected` should be the exclusive namespaced row, not a
  single raw collection row.

## Joins

Joins after a multi-source `from` should be supported and should use the normal
join semantics. The join applies to the combined stream.

For example:

- An inner join can remove rows from source branches that do not match the join.
- A left join preserves the multi-source rows and attaches the joined source
  when there is a match.
- Right and full joins should follow the existing join behavior, including the
  usual optionality implications.

Leave responsibility for choosing meaningful join conditions to the user. The
builder should still require each individual `join({ ... })` call to contain a
single source alias.

## Includes

Includes should work by the end of the implementation. For a union-sourced
parent row, an include should materialize only when the parent row has the
matching source alias needed by the include condition.

Example shape:

```ts
const query = createLiveQueryCollection((q) =>
  q
    .from({
      message: messagesCollection,
      toolCall: toolCallsCollection,
    })
    .orderBy(({ message, toolCall }) =>
      coalesce(message.timestamp, toolCall.timestamp),
      `asc`,
    )
    .select(({ message, toolCall }) => ({
      message: caseWhen(message, {
        ...message,
        chunks: q
          .from({ c: chunksCollection })
          .where(({ c }) => eq(c.messageId, message.id))
          .orderBy(({ c }) => c.timestamp)
          .select(({ c }) => c.text),
      }),
      toolCall,
    })),
)
```

This should use the general `caseWhen` operator. `caseWhen` is not specific to
multi-source `from`; it can be used anywhere a normal query expression can be
used, and in `select()` it can also conditionally return projection objects,
ref spreads, and includes. In this example it ensures the whole `message`
projection is omitted when the active row is a `toolCall` row.

The multi-source implementation can assume `caseWhen` exists and use its
conditional include routing behavior for guarded includes under source-specific
branches.

## Optimizer

The optimizer frequently assumes `query.from.alias`. Update it to understand
`UnionFrom`.

First-pass conservative behavior:

- Continue predicate extraction for direct source aliases where safe.
- Allow single-source `where` clauses to push down to the matching branch.
- Keep multi-source predicates as residual filters after concat.
- Avoid pushdown through union branch subqueries unless the existing subquery
  machinery can prove it is safe.

This should keep correctness ahead of optimization.

## Live Query Wiring

Update query traversal utilities to visit all union branches:

- `extractCollectionsFromQuery`
- `extractCollectionFromSource`
- `extractCollectionAliases`
- `validateQueryStructure`
- alias remapping for subqueries
- any helper that currently reads `query.from` as a single source

The subscription model is already per alias, which is a good fit. The main live
query risk is result key stability, so key namespacing needs focused tests.

## Order By

Ordering over combined values should work after concat:

```ts
orderBy(({ message, toolCall }) =>
  coalesce(message.timestamp, toolCall.timestamp),
)
```

For the first pass:

- Keep functional correctness for in-memory ordering.
- Disable or skip single-collection `orderBy + limit` lazy optimization for
  union sources unless the first order expression clearly maps to one branch.
- Preserve clear fallback behavior and warnings where appropriate.

## Tests

Add runtime tests:

- multi-source `from` returns rows from both collections
- result keys do not collide when branches share source keys
- insert/update/delete from each branch updates the live query
- `where` after concat can filter on branch-specific refs
- `orderBy` with `coalesce` sorts across branches
- `select()` after multi-source `from` still works with combined refs
- subquery source branches work
- `.distinct()` behavior is documented by tests
- joins after multi-source `from` behave with normal join semantics
- includes materialize only for rows with the matching source alias

Add type tests:

- no-select multi-source result is an exclusive union
- inactive aliases narrow as optional `undefined`
- `orderBy` does not change the result union
- branch refs in callbacks allow property access with nullable extraction
- `select()` returns the selected object type, even if not correlated as a union
- joins after multi-source `from` preserve the existing join optionality model
- multi-source inputs inside one `join({ ... })` call remain rejected

## Suggested Implementation Phases

1. Add `UnionFrom` IR and traversal helpers.
2. Update builder parsing and type context for multi-source `from`.
3. Compile union branches with key namespacing and stream concat.
4. Update live query extraction/subscription utilities.
5. Add no-select `GetResult` union typing.
6. Make optimizer union-aware with conservative pushdown.
7. Add order-by fallback behavior and tests.
8. Support joins after multi-source `from`.
9. Support includes from union-sourced rows using the conditional projection and
   guarded include routing behavior from `caseWhen`.
10. Revisit correlated selected result typing after the runtime API is stable.

## Decisions And Remaining Notes

- Public wording: use "multi-source `from`".
- Selected result typing should aim for the best practical DX without adding a
  large or brittle type system. No-select multi-source results should be the
  first discriminated/exclusive union target.
- Joins after multi-source `from` should work as normal joins over the combined
  stream.
- Includes are part of the desired end state and should materialize only for
  rows where the referenced source alias exists.
- Compare options note: live query collections currently inherit default string
  comparison behavior from the single `from` collection. Multi-source `from` has
  no single source collection, so the implementation should either require an
  explicit `defaultStringCollation` for ambiguous cases or choose a documented
  default. This only matters for string ordering/comparison when source
  collections have different collation settings.
