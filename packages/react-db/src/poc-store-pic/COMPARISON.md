# Comparison: useLiveQuery vs useLiveQueryConcurrent

This document compares the current `useLiveQuery` implementation with the POC `useLiveQueryConcurrent` implementation.

## Architecture Differences

### Current: useLiveQuery

```
Component
   ↓
useLiveQuery
   ↓
useSyncExternalStore ← Forces synchronous updates
   ↓
Collection.subscribeChanges()
```

**Key characteristics:**
- Uses React's `useSyncExternalStore` hook
- All updates are synchronous (bypasses concurrent features)
- Simple, well-tested, performant
- No provider required

### POC: useLiveQueryConcurrent

```
Component
   ↓
useLiveQueryConcurrent
   ↓
useCollectionStore (custom hook)
   ↓
CollectionStore (wraps Collection)
   ├── committedSnapshot ← Shown to sync renders
   └── pendingSnapshot   ← Shown to transition renders
   ↓
StoreManager (via CollectionStoreProvider)
   └── Tracks commits across React tree
```

**Key characteristics:**
- Uses custom `useCollectionStore` hook implementing store pic pattern
- Maintains committed vs pending snapshots
- Concurrent-safe (works with transitions)
- Requires `CollectionStoreProvider` wrapper

## Code Comparison

### Subscription Pattern

**useLiveQuery:**
```typescript
const snapshot = useSyncExternalStore(
  subscribeRef.current,      // Subscribe to changes
  getSnapshotRef.current     // Get current snapshot
)
```

**useLiveQueryConcurrent:**
```typescript
const store = new CollectionStore(collection)
const snapshot = useCollectionStore(store)
// Internally handles committed vs pending state
```

### State Management

**useLiveQuery:**
```typescript
// Single snapshot with versioning
const snapshot = {
  collection: collectionRef.current,
  version: versionRef.current
}
```

**useLiveQueryConcurrent:**
```typescript
// Dual snapshots for concurrent safety
const committedSnapshot = {
  entries: [...],
  status: 'ready',
  version: 1
}
const pendingSnapshot = {
  entries: [...],
  status: 'ready',
  version: 2  // May differ during transition
}
```

### Component Mounting

**useLiveQuery:**
- New components always see current state
- Can cause tearing if mounting during transition

**useLiveQueryConcurrent:**
- Mounts with pending state initially
- Fixes up to committed state in useLayoutEffect
- Prevents tearing by synchronizing with transition

## When Updates Happen

### Scenario 1: Normal Update (No Transition)

**Both implementations:**
1. Collection changes
2. Components re-render with new data
3. Works identically

### Scenario 2: Update During Transition

**useLiveQuery:**
```typescript
startTransition(() => {
  setFilter('high-priority')
})
// ❌ Update forces synchronous render
// ❌ Bypasses transition
// ❌ Can cause jank
```

**useLiveQueryConcurrent:**
```typescript
startTransition(() => {
  setFilter('high-priority')
})
// ✅ Update stays in transition
// ✅ Non-blocking
// ✅ Interruptible
```

### Scenario 3: Component Mounts Mid-Transition

**useLiveQuery:**
```
Transition in progress: showing state A → B
New component mounts
  ├── Sees current state (B)
  └── ❌ TEARING! Shows B while others show A
```

**useLiveQueryConcurrent:**
```
Transition in progress: showing state A → B
New component mounts
  ├── Sees committed state (A)
  ├── Schedules update to pending state (B)
  └── ✅ No tearing! Synchronized with transition
```

## Performance Comparison

| Aspect | useLiveQuery | useLiveQueryConcurrent |
|--------|-------------|------------------------|
| Initial mount | Fast | Slightly slower (store creation) |
| Updates | Very fast | Fast (commit tracking overhead) |
| Memory | Lower | Higher (dual snapshots) |
| Re-renders | Minimal | Minimal (same optimization strategy) |
| Provider overhead | None | Small (CommitTracker component) |

## Feature Comparison

| Feature | useLiveQuery | useLiveQueryConcurrent |
|---------|-------------|------------------------|
| Basic queries | ✅ | ✅ |
| Joins | ✅ | ✅ |
| Disabled queries | ✅ | ✅ |
| Dependencies | ✅ | ✅ |
| Pre-created collections | ✅ | ✅ |
| Works without provider | ✅ | ❌ Requires provider |
| React transitions | ❌ De-opts to sync | ✅ Fully supported |
| Concurrent rendering | ❌ Forces sync | ✅ Concurrent-safe |
| Tearing prevention | ⚠️ Can tear | ✅ Prevents tearing |
| Future React alignment | Current standard | Future concurrent API |

## Migration Path

### Step 1: Add Provider

```diff
function App() {
  return (
+   <CollectionStoreProvider>
      <YourComponents />
+   </CollectionStoreProvider>
  )
}
```

### Step 2: Replace Hook Import

```diff
- import { useLiveQuery } from '@tanstack/react-db'
+ import { useLiveQueryConcurrent as useLiveQuery } from '@tanstack/react-db/poc-store-pic'
```

### Step 3: No other changes needed!

The API is identical, so all your existing queries work as-is.

## Trade-offs

### Advantages of POC

1. **Concurrent-safe**: Works properly with React transitions
2. **No tearing**: Components mounting mid-transition see consistent state
3. **Future-aligned**: Matches upcoming React concurrent stores API
4. **Better UX**: Non-blocking updates with transitions

### Advantages of Current

1. **Simpler**: No provider required
2. **More performant**: No commit tracking overhead
3. **Better tested**: Battle-tested React hook
4. **Lower memory**: Single snapshot instead of dual
5. **Works today**: No experimental features

## Recommendations

### Use useLiveQuery (current) when:
- You don't use React transitions
- Performance is critical
- You want maximum simplicity
- You need proven, stable behavior

### Use useLiveQueryConcurrent (POC) when:
- You use React transitions heavily
- You experience tearing issues
- You want non-blocking updates
- You're okay with experimental patterns
- You want to align with future React direction

## Real-World Impact

### Example: Search with Transitions

**Current (useLiveQuery):**
```typescript
// User types in search box with debounce
const [search, setSearch] = useState('')
const { data } = useLiveQuery(
  (q) => q.from({ items }).where(({ items }) => like(items.name, search)),
  [search]
)

// Problem: When search updates, forces sync re-render
// Can cause input to feel janky if data is large
```

**POC (useLiveQueryConcurrent):**
```typescript
const [search, setSearch] = useState('')
const [isPending, startTransition] = useTransition()
const { data } = useLiveQueryConcurrent(
  (q) => q.from({ items }).where(({ items }) => like(items.name, search)),
  [search]
)

const handleSearch = (value) => {
  startTransition(() => {
    setSearch(value)
  })
}

// Solution: Search stays in transition
// Input stays responsive while data updates in background
// Shows pending state to user
```

## Future Direction

When React's concurrent stores API is released:

1. The POC pattern aligns closely with the new API
2. Migration would be straightforward
3. Could replace useLiveQuery entirely or coexist as separate hooks
4. Would gain official React support and optimizations

## Conclusion

The POC demonstrates a viable path forward for concurrent-safe reactive queries in TanStack/db. While the current `useLiveQuery` is excellent for most use cases, `useLiveQueryConcurrent` opens up new possibilities for complex UIs that need non-blocking updates and tearing prevention.
