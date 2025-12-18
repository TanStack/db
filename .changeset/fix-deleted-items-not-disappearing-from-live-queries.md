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

Two main sources could cause duplicate inserts:

1. **Race condition during subscription**: Snapshot loading methods (`requestSnapshot`, `requestLimitedSnapshot`) were adding keys to `sentKeys` AFTER calling the callback, while change events were adding keys BEFORE. If a change event arrived during callback execution, both could send the same insert.

2. **Truncate operations**: After a truncate, both server sync data and optimistic state recomputation can emit inserts for the same key in a single batch.

## The Fix

We fixed the issue at two levels:

### 1. Race Condition Prevention (subscription.ts)

Changed `requestSnapshot` and `requestLimitedSnapshot` to add keys to `sentKeys` BEFORE calling the callback:

```typescript
// Add keys to sentKeys BEFORE calling callback to prevent race condition.
// If a change event arrives while the callback is executing, it will see
// the keys already in sentKeys and filter out duplicates correctly.
for (const change of filteredSnapshot) {
  this.sentKeys.add(change.key)
}

this.snapshotSent = true
this.callback(filteredSnapshot)
```

This ensures the timing is symmetric: both snapshot loading and change events now add to `sentKeys` before the callback sees the changes.

### 2. Duplicate Insert Filtering (`filterAndFlipChanges`)

The existing `filterAndFlipChanges` method now correctly filters duplicate inserts as a safety net for any remaining edge cases (like truncate + optimistic state):

```typescript
if (change.type === 'insert' && this.sentKeys.has(change.key)) {
  continue // Skip duplicate insert
}
if (change.type === 'delete') {
  this.sentKeys.delete(change.key) // Allow future re-insert
}
```

This ensures that no matter which code path sends data to the subscription, each key can only be inserted once (until deleted).

## Testing

The fix was verified by:

1. Running the full test suite (1795 tests passing)
2. Confirming `TopKWithFractionalIndexOperator.processElement` now shows `oldMultiplicity: 1, newMultiplicity: 0` for deletes
3. Testing various scenarios: initial load, change events, truncate + optimistic mutations
