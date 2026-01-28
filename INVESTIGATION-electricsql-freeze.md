# Investigation: ElectricSQL Freeze After Shape Handle Expiration

## Summary

An application freezes (main thread blocked) when navigating back to a meeting
page after the ElectricSQL shape handle has expired. The freeze occurs because a
**partial UPDATE** is applied to a row that **never existed** in the current sync
session, creating an incomplete row object with only 5 of ~20 expected fields.

## Root Cause: Two-Layer Problem

### Layer 1: ElectricSQL Cloud Stale Cache

The ElectricSQL Cloud service uses Cloudflare caching for shape snapshots. When a
shape handle expires and the client reconnects:

1. The initial GET to `/v1/shape` returns a **stale cached snapshot**
   (`cf-cache-status: HIT`, `age: 663` = 11 minutes old)
2. This snapshot is missing rows that were created/modified after the cache was
   populated
3. The subsequent log entries (from the live `offset` parameter) DO include
   operations referencing the missing row

This creates a gap: the log references a row the client has never seen.

### Layer 2: TanStack/db Partial Update Without Guard

In `packages/db/src/collection/state.ts` (lines 590-597), partial updates are
applied using `Object.assign`:

```typescript
case `update`: {
  if (rowUpdateMode === `partial`) {
    const updatedValue = Object.assign(
      {},
      this.syncedData.get(key),  // Returns undefined — row never existed!
      operation.value,            // Only 5 fields from partial UPDATE
    )
    this.syncedData.set(key, updatedValue)  // Creates incomplete row
  }
  // ...
}
```

When `this.syncedData.get(key)` returns `undefined` (row was never inserted),
`Object.assign({}, undefined, partialData)` creates a new object containing
**only** the 5 partial fields:

```
{ calendar_event_id, last_imported_at, source_updated_at, updated_at, user_id }
```

**Missing critical fields**: `start_time`, `end_time`, `is_cancelled`,
`meeting_url`, `title`, `description`, and ~10 others.

## How the Incomplete Row Causes the Freeze

### Data Flow After Partial Update

1. **Row enters collection**: `state.ts` stores the incomplete row in `syncedData`
   and emits an `INSERT` change event (since `previousVisibleValue === undefined`
   and `newVisibleValue !== undefined`)

2. **BTree index**: The incomplete row is indexed by `start_time` field. Since
   `start_time` is `undefined`, it is stored at position 0 in the BTree
   (nulls-first ordering, the default)

3. **Subscription WHERE filter**: The subscription's `createFilteredCallback`
   evaluates the WHERE clause against the incomplete row:
   - `eq(ce.is_cancelled, false)` → evaluates `isUnknown(undefined)` → returns
     `null` (3-valued SQL logic)
   - `toBooleanPredicate(null)` → `false`
   - Row is **correctly excluded** from reaching D2 pipeline

4. **BTree traversal on every load cycle**: Despite being filtered by WHERE, the
   incomplete row is physically present in the BTree index. Every call to
   `requestLimitedSnapshot` → `index.take()` must traverse past this entry and
   evaluate the WHERE clause on it before continuing to valid entries.

### The Freeze Loop in `maybeRunGraph`

The freeze occurs in the `while (pendingWork())` loop in
`collection-config-builder.ts` (lines 339-346):

```typescript
while (syncState.graph.pendingWork()) {
  syncState.graph.run()
  syncState.flushPendingChanges?.()
  callback?.()  // loadMoreIfNeeded → may add data → creates pendingWork
}
```

Each iteration:
1. `graph.run()` processes data through the D2 pipeline (WHERE, ORDER BY, LIMIT)
2. `flushPendingChanges()` commits output changes
3. `callback()` → `loadMoreIfNeeded()` checks if the topK operator needs more
   items (`dataNeeded = Math.max(0, limit - currentSize)`)
4. If more items needed, `loadNextItems()` → `requestLimitedSnapshot()` loads from
   BTree → sends to D2 input → creates new `pendingWork()`

The loop continues as long as `callback()` adds new data to the graph. In the
normal case, this converges quickly (2-3 iterations). However, the interaction
between multiple code paths during truncate+refetch+partial-update creates
conditions where convergence is disrupted:

- **sentKeys** (subscription level): Tracks keys sent to the subscriber callback.
  NOT explicitly cleared during truncate (cleared indirectly via DELETE events).
- **sentToD2Keys** (CollectionSubscriber level): Tracks keys sent to the D2
  pipeline. Cleared by the truncate event listener.
- **biggest** (cursor tracking): Reset to `undefined` during truncate.

The mismatch between these tracking states, combined with the incomplete row in
the BTree index, can cause repeated re-evaluation of the same data without making
progress toward filling the topK operator.

### Why the Stack Shows Expression Evaluation

The reported freeze locations (`compileSingleRowRef` and `and` operator) are
expression evaluation functions called during WHERE clause evaluation. These
appear in profiling because:

1. Every BTree traversal evaluates WHERE on each candidate row
2. The `loadMoreIfNeeded` loop repeatedly triggers BTree traversals
3. Each traversal must evaluate WHERE on the incomplete row (to filter it out)
   plus all other candidate rows
4. The repeated evaluation of these expressions dominates CPU time during the
   freeze

## Specific Bug Scenario

**Calendar event**: `7ddee14e-e233-46ce-9fb4-2c65973e1c42`

**Query**: `useUpcomingMeetings` with:
```typescript
.where(({ ce }) =>
  and(
    eq(ce.is_cancelled, false),
    gte(ce.start_time, thirtyMinutesAgo),
    lte(ce.start_time, sixHoursFromNow)
  )
)
.orderBy: ({ ce }) => asc(ce.start_time)
.limit: 5
```

**Sequence of events**:
1. User loads meeting page → shape established with handle `66584833-2`
2. User navigates to inbox page → meeting page unmounts
3. User navigates back to meeting page → shape reconnects
4. Server responds with `409 Gone` (handle expired)
5. Client performs must-refetch with new handle `66584833-3`
6. Initial GET returns **stale snapshot** (cached 11 min, missing event 7ddee14e)
7. Live log includes partial UPDATE for event 7ddee14e (only 5 fields changed
   externally — someone moved the meeting time)
8. `state.ts` creates incomplete row via `Object.assign({}, undefined, partial)`
9. App freezes in `maybeRunGraph` loop

**HTTP evidence**:
- Request 4 (GET `/v1/shape?handle=66584833-3`): `cf-cache-status: HIT`,
  `age: 663` (11 minutes stale)
- Event 7ddee14e appears ONLY as a partial UPDATE in the log, never as INSERT in
  any request

## Recommended Fixes

### Fix 1: Guard partial UPDATE in state.ts (TanStack/db) — **Primary fix**

In `packages/db/src/collection/state.ts`, skip partial UPDATEs when the row
doesn't exist:

```typescript
case `update`: {
  if (rowUpdateMode === `partial`) {
    const existingValue = this.syncedData.get(key)
    if (existingValue === undefined) {
      // Skip partial update for non-existent row — this can happen when a stale
      // snapshot is missing the row but the log contains an UPDATE for it.
      console.warn(
        `Skipping partial update for non-existent key: ${String(key)}`
      )
      break
    }
    const updatedValue = Object.assign({}, existingValue, operation.value)
    this.syncedData.set(key, updatedValue)
  } else {
    this.syncedData.set(key, operation.value)
  }
  break
}
```

### Fix 2: Electric adapter guard (TanStack/db)

In the ElectricSQL adapter (`packages/electric-db-collection/src/electric.ts`),
detect and discard UPDATEs for rows not in the current sync state:

```typescript
// When processing UPDATE messages, check if the key exists
if (operation.type === 'update' && !this.syncedKeys.has(key)) {
  // Row was never inserted — likely from stale snapshot + log gap
  // Discard or request full row via loadSubset
  return
}
```

### Fix 3: ElectricSQL Cloud — Cache coherence

Ensure that after a shape handle expires, the initial snapshot served to the
reconnecting client is **fresh** (not stale from Cloudflare cache). Options:
- Add `Cache-Control: no-cache` for initial shape requests after handle changes
- Include the previous handle in the reconnect request to ensure the snapshot is
  at least as recent as that handle's epoch
- Use `Vary` headers or cache keys that include handle-relevant state

### Fix 4: Defensive maybeRunGraph loop bound (TanStack/db)

Add a maximum iteration count to the `while (pendingWork())` loop to prevent
indefinite freezes even if the root cause is not fully addressed:

```typescript
const MAX_GRAPH_ITERATIONS = 100
let iterations = 0
while (syncState.graph.pendingWork() && iterations < MAX_GRAPH_ITERATIONS) {
  syncState.graph.run()
  syncState.flushPendingChanges?.()
  callback?.()
  iterations++
}
if (iterations >= MAX_GRAPH_ITERATIONS) {
  console.warn('maybeRunGraph reached maximum iterations — possible infinite loop')
}
```

## Key Code Locations

| File | Lines | Role |
|------|-------|------|
| `packages/db/src/collection/state.ts` | 590-601 | Partial update merging (root cause) |
| `packages/db/src/query/live/collection-config-builder.ts` | 339-346 | `maybeRunGraph` while loop (freeze location) |
| `packages/db/src/query/live/collection-subscriber.ts` | 142-187 | `sendChangesToPipeline` with dedup |
| `packages/db/src/query/live/collection-subscriber.ts` | 286-311 | `loadMoreIfNeeded` callback |
| `packages/db/src/query/live/collection-subscriber.ts` | 343-378 | `loadNextItems` cursor-based loading |
| `packages/db/src/collection/subscription.ts` | 414-600 | `requestLimitedSnapshot` with BTree |
| `packages/db/src/collection/subscription.ts` | 146-219 | `handleTruncate` buffering |
| `packages/db/src/collection/change-events.ts` | 221-236 | `createFilterFunctionFromExpression` |
| `packages/db/src/collection/change-events.ts` | 244-299 | `createFilteredCallback` WHERE filter |
| `packages/db/src/indexes/btree-index.ts` | 261-291 | `takeInternal` BTree traversal |
| `packages/db/src/query/compiler/evaluators.ts` | 13-31 | `isUnknown`/`toBooleanPredicate` |
| `packages/db/src/query/compiler/order-by.ts` | 224-290 | OrderBy optimization info |
| `packages/db/src/utils/comparison.ts` | 24-78 | `ascComparator` null handling |
| `packages/electric-db-collection/src/electric.ts` | — | ElectricSQL shape stream integration |

## ElectricSQL Behavior Reference

- **`replica=default`** (default mode): UPDATE log entries contain **only changed
  columns**, not the full row. This is why the partial UPDATE has only 5 fields.
- **Shape handle expiration**: When a handle expires, the client receives a `409
  Gone` response and must re-establish the shape with a new handle.
- **Log offset format**: `{tx_offset}_{op_offset}` — the log contains operations
  since the snapshot's offset.
- **Snapshot vs. log gap**: If the snapshot is stale (cached), the log may
  reference rows not present in the snapshot.
