# Investigation: ElectricSQL Freeze — Stale Snapshot + Partial UPDATE on Non-Existent Row

## Summary

An application freezes (main thread blocked) when navigating back to a meeting
page. The freeze occurs because a **partial UPDATE** is applied to a row that
**never existed** in the current sync session, creating an incomplete row object
with only 5 of ~20 expected fields.

## Root Cause: Two-Layer Problem

### Layer 1: Stale Cloudflare-Cached Snapshot

The original notes show 4 data requests to the shape endpoint. **No 409 response
was observed.** All requests carry `expired_handle=100275401-1769099428807830` —
the old handle was already known-expired before these requests began (from
ElectricSQL's `ExpiredShapesCache`, likely persisted from a prior session or
earlier navigation).

The `expired_handle` parameter is designed to bust the Cloudflare cache when
requesting a fresh shape (`offset=-1`). However, Cloudflare still served a stale
cached response:

- **Request 1** (`offset=-1`): `cf-cache-status: HIT`, `age: 663` (11 min stale)
  — Returns new handle `100275401-1769509446955764`, offset `0_0`
- **Requests 2-3** (`offset=0_0`, `0_1`): Snapshot pages — `cf-cache-status: REVALIDATED`
- **Request 4** (`offset=0_2`): Jumps to `5264441183696_0` (real LSN — this is the
  snapshot-to-log transition). Contains the partial UPDATE for `7ddee14e` and
  `electric-up-to-date` header.
- **Request 5**: `live=true` polling, returns `up-to-date`

The stale snapshot (requests 1-3) is missing the calendar event `7ddee14e`. The
log (request 4) includes a partial UPDATE for it — creating a gap where the log
references a row the client has never seen.

**Related**: This may be related to the stale cache offset bug described in
[electric-sql/electric#3785](https://github.com/electric-sql/electric/issues/3785),
where the system "correctly kept its current handle but incorrectly updated the
offset from the stale response, creating mismatched state." The `expired_handle`
cache-busting mechanism appears insufficient to prevent Cloudflare from serving
stale snapshot data.

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
1. User loads meeting page → shape established (previous handle
   `100275401-1769099428807830`)
2. User navigates to inbox page → meeting page unmounts
3. At some prior point, the old handle was marked expired in `ExpiredShapesCache`
   (stored in localStorage). The original notes do **not** show a 409 response —
   the handle may have been marked expired in a prior session or earlier navigation.
4. User navigates back to meeting page → client requests fresh shape (`offset=-1`)
   with `expired_handle=100275401-1769099428807830` as cache buster
5. Cloudflare serves **stale cached snapshot** (`cf-cache-status: HIT`, `age: 663`)
   despite the `expired_handle` cache-busting param
6. Server returns new handle `100275401-1769509446955764`
7. Snapshot (requests 1-3, offsets `0_0` → `0_1` → `0_2`) is missing event
   `7ddee14e` due to stale cache
8. Log (request 4, offset jumps to `5264441183696_0`) includes partial UPDATE for
   event 7ddee14e (only 5 fields — `replica=default` sends only changed columns)
9. `state.ts` creates incomplete row via `Object.assign({}, undefined, partial)`
10. App freezes in `maybeRunGraph` loop

**HTTP evidence**:
- Request 1 (`offset=-1`): `cf-cache-status: HIT`, `age: 663` (11 min stale)
- Requests 2-3: `cf-cache-status: REVALIDATED` (snapshot continuation)
- Request 4: offset jumps from `0_2` to `5264441183696_0` (snapshot→log transition),
  contains partial UPDATE for 7ddee14e, has `electric-up-to-date` header
- Event 7ddee14e appears ONLY as a partial UPDATE in request 4, never as INSERT in
  any request
- Possibly related to [electric-sql/electric#3785](https://github.com/electric-sql/electric/issues/3785)
  (stale handle / stale cache offset bug)

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

### Fix 3: ElectricSQL — Stale snapshot cache busting

The `expired_handle` query parameter is supposed to bust the Cloudflare cache, but
request 1 still returned `cf-cache-status: HIT` with `age: 663`. This may be
related to the stale cache offset bug tracked in
[electric-sql/electric#3785](https://github.com/electric-sql/electric/issues/3785).

Options:
- Investigate why `expired_handle` doesn't prevent Cloudflare cache HITs
- Ensure the Cloudflare cache key includes the `expired_handle` parameter
- Add a unique nonce/timestamp to the initial `offset=-1` request URL
- Address the broader state machine issues described in #3785 to prevent
  mismatched handle/offset state from stale responses

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
- **Shape handle invalidation**: Handles become invalid when the server evicts,
  rotates, or otherwise removes a shape. The client receives a `409 Gone`
  response and must re-establish with a new handle. The client tracks expired
  handles in `ExpiredShapesCache` (localStorage) and passes them as
  `expired_handle` query param on fresh requests for cache busting.
  **Note**: In this bug, no 409 was observed — the handle was already marked
  expired from a prior session.
- **Log offset format**: `{tx_offset}_{op_offset}` — the log contains operations
  since the snapshot's offset. Snapshot offsets use `0_N` format; real log offsets
  use LSN-based values like `5264441183696_0`.
- **Snapshot vs. log gap**: If the snapshot is stale (cached by Cloudflare), the
  log may reference rows not present in the snapshot. The `expired_handle` cache
  buster is supposed to prevent this but does not always succeed.
- **Related issue**: [electric-sql/electric#3785](https://github.com/electric-sql/electric/issues/3785)
  — ShapeStream state machine bugs including stale cache offset handling.
