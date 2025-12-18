---
'@tanstack/db': patch
---

fix: deleted items not disappearing from live queries with `.limit()`

## The Problem

When using live queries with `.orderBy()` and `.limit()` (pagination), deleting an item would not remove it from the query results. The `subscribeChanges` callback would never fire with a delete event.

```typescript
const liveQuery = collection
  .liveQuery()
  .where(...)
  .orderBy(({ offer }) => offer.createdAt, 'desc')
  .limit(pageSize)
  .offset(pageIndex * pageSize)

// This callback would never fire for deletes
liveQuery.subscribeChanges((changes) => {
  // changes never included delete events
})

// Deleting an item would leave it visible in the query
collection.delete(itemId)
```

## Root Cause

The issue was caused by **duplicate inserts** reaching the D2 (differential dataflow) pipeline, which uses **multiplicity tracking** to determine item visibility.

### How D2 Multiplicity Works

The `TopKWithFractionalIndexOperator` (used for `orderBy` + `limit` queries) tracks each item's "multiplicity":

- When an INSERT (+1) arrives: multiplicity goes from 0 → 1, item becomes visible
- When a DELETE (-1) arrives: multiplicity goes from 1 → 0, item becomes invisible

The key insight is in `processElement`:

```typescript
if (oldMultiplicity <= 0 && newMultiplicity > 0) {
  // INSERT: item becomes visible
  res = this.#topK.insert([key, value])
} else if (oldMultiplicity > 0 && newMultiplicity <= 0) {
  // DELETE: item becomes invisible
  res = this.#topK.delete([key, value])
} else {
  // NO CHANGE: item visibility unchanged
}
```

### The Bug

If the same item was inserted **twice** (due to overlapping code paths), the multiplicity would be:

1. First INSERT: 0 → 1 (item visible) ✓
2. **Duplicate INSERT**: 1 → 2 (item still visible, but now with wrong multiplicity)
3. DELETE: 2 → 1 (multiplicity > 0, so **NO DELETE EVENT** emitted!)

The item would remain visible in the query results even though it was deleted from the source collection.

### Why This Only Affected Queries with `.limit()`

Queries without `.limit()` don't use the `TopKWithFractionalIndexOperator`, so they don't have multiplicity-based visibility tracking. Deletes flow through the simpler D2 pipeline directly.

### Sources of Duplicate Inserts

Multiple code paths could send the same item to D2:

1. **Initial data loading** via `requestLimitedSnapshot()`
2. **Collection change events** via subscription callbacks
3. **Lazy loading** when scrolling/paginating
4. **Multiple live queries** on the same source collection

Each `CollectionSubscriber` (one per live query) has its own D2 pipeline, and the `CollectionSubscription` on the source collection could send duplicates through different callbacks.

## The Fix

We added deduplication at **two levels**:

### 1. CollectionSubscription Level (`filterAndFlipChanges`)

Tracks `sentKeys` - a Set of keys that have been sent to subscribers:

- **Duplicate inserts**: Skip if key already in `sentKeys`
- **Deletes**: Remove key from `sentKeys` (allowing future re-inserts)

```typescript
if (change.type === 'insert' && this.sentKeys.has(change.key)) {
  continue // Skip duplicate insert
}
if (change.type === 'delete') {
  this.sentKeys.delete(change.key) // Allow future re-insert
}
```

### 2. CollectionSubscriber Level (`sendChangesToPipeline`)

Each live query's `CollectionSubscriber` now tracks `sentToD2Keys` - keys that have been sent to its D2 pipeline:

- **Duplicate inserts**: Skip if key already sent to this D2 pipeline
- **Deletes**: Remove from tracking (allowing re-inserts after delete)
- **Truncate**: Clear all tracking (allowing full reload)

```typescript
if (change.type === 'insert' && this.sentToD2Keys.has(change.key)) {
  continue // Skip duplicate - already in D2 with multiplicity 1
}
```

This ensures that no matter which code path sends data to D2 (initial load, change events, lazy loading), each key can only have multiplicity 1 in the D2 pipeline.

## Testing

The fix was verified by:

1. Tracing through the D2 pipeline with debug logging
2. Confirming `TopKWithFractionalIndexOperator.processElement` now shows `oldMultiplicity: 1, newMultiplicity: 0` for deletes
3. Running the full test suite (1795 tests passing)
