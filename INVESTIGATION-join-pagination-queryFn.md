# Investigation: Passing Join Information to queryFn in On-Demand Mode

**Status: IMPLEMENTED**

## Problem Statement

When using `queryCollection` in on-demand mode with joins and pagination, the pagination was applied **before** join filters were evaluated, leading to inconsistent page sizes or empty results.

**User's scenario:**

- `tasksCollection` (queryCollection, on-demand) with `limit: 10`
- Joined with `accountsCollection`
- Filter on `account.name = 'example'`

**What was happening:**

1. `tasksCollection.queryFn` received `{ limit: 10, where: <task filters only> }`
2. Backend returned 10 tasks
3. Client-side join with `accountsCollection`
4. Account filter applied client-side
5. Result: Only 6 tasks match (page size inconsistent)

## Solution Implemented

We extended `LoadSubsetOptions` to include join information, allowing the sync layer to construct server-side join queries that filter before pagination.

### New `JoinInfo` Type

```typescript
// packages/db/src/types.ts
export type JoinInfo = {
  /** The ID of the collection being joined */
  collectionId: string
  /** The alias used for the joined collection in the query */
  alias: string
  /** The type of join to perform */
  type: `inner` | `left` | `right` | `full` | `cross`
  /** The join key expression from the main collection (e.g., task.account_id) */
  localKey: BasicExpression
  /** The join key expression from the joined collection (e.g., account.id) */
  foreignKey: BasicExpression
  /** Filters that apply to the joined collection */
  where?: BasicExpression<boolean>
  /** OrderBy expressions that reference the joined collection */
  orderBy?: OrderBy
}
```

### Extended `LoadSubsetOptions`

```typescript
export type LoadSubsetOptions = {
  where?: BasicExpression<boolean>
  orderBy?: OrderBy
  limit?: number
  cursor?: CursorExpressions
  offset?: number
  subscription?: Subscription
  // NEW: Join information for server-side query construction
  joins?: Array<JoinInfo>
}
```

## Implementation Details

### 1. Join Info Extraction (`packages/db/src/query/optimizer.ts`)

Added `extractJoinInfo()` function that:

- Analyzes query IR to extract join clause information
- Associates filters from `sourceWhereClauses` with their respective joins
- Associates orderBy expressions with their respective joins
- Returns a map of main source alias → Array<JoinInfo>

### 2. Compilation Pipeline (`packages/db/src/query/compiler/index.ts`)

- `CompilationResult` now includes `joinInfoBySource`
- `compileQuery()` passes through join info from optimizer

### 3. Live Query Builder (`packages/db/src/query/live/collection-config-builder.ts`)

- Added `joinInfoBySourceCache` to store join info
- Populated during compilation

### 4. Collection Subscriber (`packages/db/src/query/live/collection-subscriber.ts`)

- Added `getJoinInfoForAlias()` method
- Passes join info when creating subscriptions

### 5. Collection Subscription (`packages/db/src/collection/subscription.ts`)

- `CollectionSubscriptionOptions` now accepts `joinInfo`
- `requestLimitedSnapshot()` includes `joins` in `LoadSubsetOptions`

### 6. Serialization (`packages/query-db-collection/src/serialization.ts`)

- `serializeLoadSubsetOptions()` now serializes join info for query key generation

## Usage in queryFn

Now `queryFn` can access join information:

```typescript
queryFn: async (context) => {
  const opts = context.meta.loadSubsetOptions

  if (opts.joins?.length) {
    // Construct a query with server-side joins
    // Example with Drizzle:
    let query = db.select().from(tasks)

    for (const join of opts.joins) {
      // Add join based on join.type, join.localKey, join.foreignKey
      query = query.innerJoin(accounts, eq(tasks.accountId, accounts.id))

      // Apply joined collection's filter
      if (join.where) {
        query = query.where(/* translate join.where to Drizzle */)
      }
    }

    // Apply main collection's filter
    if (opts.where) {
      query = query.where(/* translate opts.where to Drizzle */)
    }

    return query.limit(opts.limit).offset(opts.offset)
  }

  // Simple query without joins (existing behavior)
  return db.select().from(tasks).where(/* opts.where */).limit(opts.limit)
}
```

## Files Changed

- `packages/db/src/types.ts` - Added `JoinInfo` type, extended `LoadSubsetOptions` and `SubscribeChangesOptions`
- `packages/db/src/query/optimizer.ts` - Added `extractJoinInfo()`, updated `OptimizationResult`
- `packages/db/src/query/compiler/index.ts` - Added `joinInfoBySource` to `CompilationResult`
- `packages/db/src/query/live/collection-config-builder.ts` - Added `joinInfoBySourceCache`
- `packages/db/src/query/live/collection-subscriber.ts` - Added `getJoinInfoForAlias()`
- `packages/db/src/collection/subscription.ts` - Pass join info in `loadSubset` calls
- `packages/query-db-collection/src/serialization.ts` - Serialize joins in query keys
- `packages/db/tests/query/optimizer.test.ts` - Added tests for join info extraction

## Test Coverage

Added tests in `packages/db/tests/query/optimizer.test.ts`:

- Empty map for queries without joins
- Basic inner join extraction
- WHERE clause inclusion for joined collections
- OrderBy inclusion for joined collections
- Multiple joins handling
- Swapped key expression handling
