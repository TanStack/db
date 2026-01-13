# Investigation: Passing Join Information to queryFn in On-Demand Mode

## Problem Statement

When using `queryCollection` in on-demand mode with joins and pagination, the pagination is applied **before** join filters are evaluated, leading to inconsistent page sizes or empty results.

**User's scenario:**
- `tasksCollection` (queryCollection, on-demand) with `limit: 10`
- Joined with `accountsCollection`
- Filter on `account.name = 'example'`

**What happens:**
1. `tasksCollection.queryFn` receives `{ limit: 10, where: <task filters only> }`
2. Backend returns 10 tasks
3. Client-side join with `accountsCollection`
4. Account filter applied client-side
5. Result: Only 6 tasks match (page size inconsistent)

## Root Cause

### Current `LoadSubsetOptions` Structure

```typescript
// packages/db/src/types.ts:285-312
export type LoadSubsetOptions = {
  where?: BasicExpression<boolean>    // Filters for THIS collection only
  orderBy?: OrderBy                   // OrderBy for THIS collection only
  limit?: number
  cursor?: CursorExpressions
  offset?: number
  subscription?: Subscription
}
```

**Key limitation:** No fields for join information, cross-collection filters, or cross-collection ordering.

### How Filters Are Currently Partitioned

The optimizer (`packages/db/src/query/optimizer.ts`) already partitions WHERE clauses:

```typescript
interface GroupedWhereClauses {
  singleSource: Map<string, BasicExpression<boolean>>  // Per-collection filters
  multiSource?: BasicExpression<boolean>               // Cross-collection filters (e.g., joins)
}
```

- **Single-source clauses** (e.g., `eq(task.status, 'active')`) → passed to that collection's subscription
- **Multi-source clauses** (e.g., `eq(task.account_id, account.id)`) → applied in the D2 pipeline after join

The problem: When `tasksCollection` calls `loadSubset`, it has no knowledge of:
1. The join with `accountsCollection`
2. Filters that apply to `accountsCollection` (e.g., `eq(account.name, 'example')`)
3. That results will be filtered after the join

### Code Flow

```
CollectionSubscriber.subscribe()
  ↓
getWhereClauseForAlias() → only returns single-source filters for THIS alias
  ↓
subscribeToOrderedChanges()
  ↓
requestLimitedSnapshot({ limit: 10, where: <task filters only> })
  ↓
loadSubset({ limit: 10, where: <task filters only> })  // No join info!
  ↓
queryFn receives: { limit: 10, where: <task filters only> }
```

**Key files:**
- `packages/db/src/collection/subscription.ts:587-595` - constructs LoadSubsetOptions
- `packages/db/src/query/live/collection-subscriber.ts:380-387` - getWhereClauseForAlias
- `packages/db/src/query/optimizer.ts:228-258` - extractSourceWhereClauses

## Proposed Solution

### Extend `LoadSubsetOptions` with Join Information

```typescript
export type LoadSubsetOptions = {
  // Existing fields
  where?: BasicExpression<boolean>
  orderBy?: OrderBy
  limit?: number
  cursor?: CursorExpressions
  offset?: number
  subscription?: Subscription

  // NEW: Join information for server-side query construction
  joins?: Array<JoinInfo>
}

export type JoinInfo = {
  /** The collection being joined */
  collectionId: string

  /** Join type */
  type: 'inner' | 'left' | 'right' | 'full' | 'cross'

  /** Join key from this collection (e.g., task.account_id) */
  localKey: BasicExpression

  /** Join key from joined collection (e.g., account.id) */
  foreignKey: BasicExpression

  /** Filters that apply to the joined collection */
  where?: BasicExpression<boolean>

  /** OrderBy expressions from the joined collection (if ordering by joined fields) */
  orderBy?: OrderBy
}
```

### Implementation Changes Required

#### 1. Extract Join Info During Query Compilation

In `packages/db/src/query/compiler/index.ts`, when processing joins:

```typescript
// After processJoins(), collect join info for each collection
const joinInfoByCollection = new Map<string, JoinInfo[]>()

for (const joinClause of query.join) {
  const mainCollectionId = getCollectionId(query.from)
  const joinedCollectionId = getCollectionId(joinClause.from)

  // Get filters that apply to the joined collection
  const joinedFilters = sourceWhereClauses.get(joinedAlias)

  const joinInfo: JoinInfo = {
    collectionId: joinedCollectionId,
    type: joinClause.type,
    localKey: joinClause.left,   // e.g., task.account_id
    foreignKey: joinClause.right, // e.g., account.id
    where: joinedFilters,
  }

  // Store for the main collection
  if (!joinInfoByCollection.has(mainCollectionId)) {
    joinInfoByCollection.set(mainCollectionId, [])
  }
  joinInfoByCollection.get(mainCollectionId)!.push(joinInfo)
}
```

#### 2. Pass Join Info to CollectionSubscriber

In `packages/db/src/query/live/collection-config-builder.ts`:

```typescript
// Store join info alongside sourceWhereClauses
this.joinInfoCache = compilation.joinInfoByCollection
```

#### 3. Include Join Info in loadSubset Call

In `packages/db/src/collection/subscription.ts:587-595`:

```typescript
const loadOptions: LoadSubsetOptions = {
  where,
  limit,
  orderBy,
  cursor: cursorExpressions,
  offset: offset ?? currentOffset,
  subscription: this,
  // NEW: Include join info if available
  joins: this.joinInfo,
}
```

#### 4. Update queryCollection to Use Join Info

In `packages/query-db-collection/src/query.ts`, the `queryFn` would receive join info via `context.meta.loadSubsetOptions.joins` and can construct a proper server-side query:

```typescript
queryFn: async (context) => {
  const opts = context.meta.loadSubsetOptions

  if (opts.joins?.length) {
    // Construct a query that joins server-side
    // e.g., for Drizzle:
    // db.select().from(tasks)
    //   .innerJoin(accounts, eq(tasks.accountId, accounts.id))
    //   .where(and(taskFilters, accountFilters))
    //   .orderBy(...)
    //   .limit(opts.limit)
  } else {
    // Simple query without joins
  }
}
```

## Alternative Approaches

### 1. Deoptimize Joins with Pagination

When the main collection has `limit/offset` AND there are joins with filters, load the entire lazy collection state instead of using lazy loading. This ensures all data is available client-side before filtering.

**Pros:** Simpler implementation, no changes to LoadSubsetOptions
**Cons:** Poor performance for large collections, defeats purpose of on-demand mode

### 2. Iterative Loading

When the result set is smaller than `limit` after join filtering, automatically request more data.

**Pros:** Works with existing API
**Cons:** Multiple round trips, poor UX (results "growing"), hard to implement correctly

### 3. Estimated Overfetch

Pass an overfetch factor based on estimated join selectivity.

**Pros:** Simple
**Cons:** Unreliable, wastes bandwidth, still may not return enough results

## Recommendation

Implement **Option 1: Extend LoadSubsetOptions with Join Information**

This is the most robust solution because:

1. **Server-side efficiency** - The server can perform the join and filter before pagination, returning exactly `limit` matching results
2. **Works with existing backends** - SQL databases, ORMs like Drizzle/Prisma, and GraphQL all support server-side joins
3. **Preserves on-demand semantics** - Only loads data that's actually needed
4. **Future-proof** - Can be extended for more complex scenarios (nested joins, aggregates)

## Implementation Effort

- **Types:** Add `JoinInfo` type and extend `LoadSubsetOptions` (~20 lines)
- **Compiler:** Extract join info during compilation (~50 lines)
- **Subscription:** Pass join info to loadSubset (~30 lines)
- **queryCollection:** Document how to use join info in queryFn (docs)
- **Tests:** Add tests for join info extraction and passing (~100 lines)

Estimated: ~200 lines of core implementation + tests + documentation

## Questions for Discussion

1. Should `JoinInfo.where` include only single-source filters for the joined collection, or all filters that touch it?

2. How should multi-level joins be represented? (e.g., tasks → accounts → organizations)

3. Should there be a way to opt-out of join info passing for simple use cases?

4. How should this interact with subqueries? (e.g., `.from({ user: subquery })`)
