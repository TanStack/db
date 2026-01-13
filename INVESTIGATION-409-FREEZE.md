# Investigation: App Freezing with 409 Must-Refetch Loops

**Date:** 2026-01-13
**Branch:** claude/investigate-app-freezing-gOMjN

## Summary

Two similar bug reports describe app/browser freezing related to TanStack DB with Electric collections. Both share a common root cause: **409 must-refetch responses triggering subscription re-requests that can cause more 409s, creating an infinite loop**.

---

## Bug Report 1: Melvin Hagberg - Desktop Electron App Freezing

### Symptoms
- Infinite loop with `useLiveQuery` causing spamming re-renders
- CPU above 100%, app freezing
- Clearing ElectricSQL cache resolved the issue
- Large data: 14k emails, 140k recipients, 20k calendar events, 84k participants

### Key Quote
> "In the app, it seems like there is an infinite loop happening with the useLiveQuery where they are spammingly re-rendered, causing the app to freeze"

---

## Bug Report 2: makisuo - awaitTxId Blocking Forever

### Symptoms
- `awaitTxId` never resolves
- Collections throwing 409 errors
- Browser window completely frozen/locked up
- Related to tagged queries/subqueries
- Mutation creates channel + channel member, causing updates to 4 different shapes

### Key Quote
> "awaitTxId seems to block the entire thread making the browser window frozen. Must have something to do with tagged queries/subqueries since all of those mutations would cause a change in those subqueries."

---

## Root Cause Analysis

### The 409 Must-Refetch Cascade

Both bugs stem from the same fundamental issue:

```
409 must-refetch → truncate() → handleTruncate() → loadSubset()
                                                        ↓
                                    if subquery triggers 409 → REPEAT
```

### Code Flow

1. **Electric receives 409** (`packages/electric-db-collection/src/electric.ts:1410-1437`):
   - Calls `truncate()` on the collection
   - Resets `loadSubsetDedupe`
   - Clears buffered messages

2. **Collection emits truncate event** (`packages/db/src/collection/state.ts:534`):
   ```typescript
   this._events.emit('truncate', { type: 'truncate', collection: this.collection })
   ```

3. **Subscription handles truncate** (`packages/db/src/collection/subscription.ts:146-219`):
   ```typescript
   private handleTruncate() {
     const subsetsToReload = [...this.loadedSubsets]
     this.isBufferingForTruncate = true

     queueMicrotask(() => {
       for (const options of subsetsToReload) {
         const syncResult = this.collection._sync.loadSubset(options)
         // ...
       }
     })
   }
   ```

4. **If subquery causes another 409** → cycle repeats

### Why This Causes Freezing

Each cycle iteration:
1. Fires `truncate` event
2. Triggers `status:change` events
3. Causes `useLiveQuery` to bump version and call `onStoreChange()` (`packages/react-db/src/useLiveQuery.ts:424`)
4. React schedules re-renders
5. With large datasets, `commitPendingTransactions()` runs synchronously for extended periods

With thousands of items and rapid 409 cycles, the main thread becomes completely blocked.

### Why awaitTxId Appears to "Block"

The `awaitTxId` function itself is async, but:
1. When 409 occurs, the shape stream restarts from a different offset
2. The original txid may never arrive on the new stream
3. While waiting, the 409 cascade blocks the main thread
4. The timeout (5000ms default) doesn't help because the event loop is starved

---

## Key Code Locations

| File | Lines | Description |
|------|-------|-------------|
| `packages/electric-db-collection/src/electric.ts` | 1410-1437 | 409 must-refetch handling |
| `packages/db/src/collection/subscription.ts` | 146-219 | `handleTruncate()` implementation |
| `packages/db/src/collection/subscription.ts` | 185-211 | Subset re-request loop (no cycle guard) |
| `packages/react-db/src/useLiveQuery.ts` | 422-431 | Change subscription triggers re-render |
| `packages/db/src/collection/state.ts` | 424-808 | Synchronous commit processing |
| `packages/db/src/query/live/collection-config-builder.ts` | 336-344 | Graph processing loop |

---

## Recommended Fixes

### 1. Add 409 Cycle Detection (High Priority)

Add guards in `subscription.ts` to detect and break rapid truncate cycles:

```typescript
private lastTruncateTime: number = 0
private truncateCount: number = 0
private readonly TRUNCATE_COOLDOWN_MS = 1000
private readonly MAX_TRUNCATES_PER_COOLDOWN = 3

private handleTruncate() {
  const now = Date.now()
  if (now - this.lastTruncateTime < this.TRUNCATE_COOLDOWN_MS) {
    this.truncateCount++
    if (this.truncateCount > this.MAX_TRUNCATES_PER_COOLDOWN) {
      console.error('[TanStack DB] Detected 409 must-refetch loop, breaking cycle')
      // Reset state but don't re-request subsets
      this.snapshotSent = false
      this.loadedInitialState = false
      this.loadedSubsets = []
      return
    }
  } else {
    this.truncateCount = 1
  }
  this.lastTruncateTime = now
  // ... rest of handleTruncate
}
```

### 2. Resolve Pending awaitTxId on 409 (Medium Priority)

In `electric.ts`, when 409 occurs, resolve pending promises instead of letting them hang:

```typescript
if (isMustRefetchMessage(message)) {
  // Resolve pending matches gracefully
  pendingMatches.setState((current) => {
    current.forEach((match) => {
      clearTimeout(match.timeoutId)
      match.resolve(false) // Signal that sync was interrupted
    })
    return new Map()
  })
  // ... rest of 409 handling
}
```

### 3. Async/Chunked Commit Processing (Medium Priority)

In `commitPendingTransactions()`, consider yielding to the event loop for large batches:

```typescript
// Process in chunks with requestIdleCallback or setTimeout
async commitPendingTransactionsAsync() {
  const CHUNK_SIZE = 1000
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE)
    // Process chunk...
    if (i + CHUNK_SIZE < operations.length) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}
```

### 4. Rate-Limit Status Changes (Low Priority)

Debounce rapid status change propagation during truncate cycles.

---

## Immediate Workarounds

1. **Disable tagged subqueries** if possible (`tagged_subqueries: false`)
2. **Avoid complex subqueries** that might trigger 409s
3. **Reduce initial data load** where possible
4. **Add error boundaries** around components using useLiveQuery
5. **Implement timeout handling** around awaitTxId calls:
   ```typescript
   try {
     await collection.utils.awaitTxId(txid, 3000)
   } catch (e) {
     // Handle timeout/409 gracefully
     console.warn('Sync interrupted, continuing optimistically')
   }
   ```

---

## Questions for Users

1. What specific queries/shapes are being used?
2. Are there joins or WHERE clauses referencing other collections?
3. What are the exact subquery configurations?
4. Are you on the latest versions of @tanstack/db and @electric-sql/client?

---

## Related Issues

- CHANGELOG mentions: "Fix infinite loop bug with queries that use orderBy clause with a limit" (#450)
- 409 must-refetch is expected behavior for some subquery types per vbalegas

## References

- `packages/db/CHANGELOG.md` - Recent fixes and changes
- Electric documentation on tagged queries and 409 handling
