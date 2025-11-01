# Technical Deep Dive: Store Pic Pattern Implementation

This document explains the technical internals of the store pic (concurrent store) pattern POC.

## Core Concepts

### 1. The "Pic" in Store Pic

"Pic" is short for **"picture"** or **"snapshot"** - a frozen point-in-time view of the store's state.

The key innovation is maintaining **two pictures simultaneously**:

```typescript
interface CollectionSnapshot<TResult, TKey> {
  entries: Array<[TKey, TResult]>  // Frozen array of entries
  status: string                    // Snapshot of status
  version: number                   // Monotonically increasing version
}

// In CollectionStore:
private committedSnapshot: CollectionSnapshot  // What sync renders see
private pendingSnapshot: CollectionSnapshot    // What transition renders see
```

### 2. React Internals Usage

To detect if we're inside a transition, we access React internals:

```typescript
const sharedReactInternals: { T: unknown } =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as any

function reactTransitionIsActive() {
  return !!sharedReactInternals.T
}
```

When `T` is truthy, we're inside a `startTransition()` callback.

**Why this works:**
- React sets `T` when entering a transition
- Cleared when transition completes or is interrupted
- This is how React internally tracks transition context

**Risks:**
- Internal API could change
- Not officially supported
- Future React may provide official API

### 3. State Rebasing Algorithm

The most complex part is handling sync updates during transitions:

```typescript
private handleCollectionUpdate() {
  this.version += 1
  const noPendingTransitions =
    this.committedSnapshot === this.pendingSnapshot
  const newSnapshot = this.captureSnapshot()
  this.pendingSnapshot = newSnapshot

  if (reactTransitionIsActive()) {
    // CASE 1: Update happening inside a transition
    // Simple: just notify with new pending snapshot
    this.notify()
  } else {
    if (noPendingTransitions) {
      // CASE 2: Sync update, no ongoing transition
      // Simple: commit immediately and notify
      this.committedSnapshot = newSnapshot
      this.notify()
    } else {
      // CASE 3: Sync update DURING a transition (complex!)
      // Must juggle both committed and pending states

      // 1. Commit the new snapshot for sync renders
      this.committedSnapshot = newSnapshot
      this.notify()  // Sync components update immediately

      // 2. Update pending snapshot too
      this.pendingSnapshot = newSnapshot

      // 3. Schedule transition update
      startTransition(() => {
        this.notify()  // Transition components catch up
      })
    }
  }
}
```

**Why this is complex:**

Imagine this timeline:
```
t=0: State A (committed and pending)
t=1: startTransition(() => setState(B))
     - committedSnapshot: A
     - pendingSnapshot: B
     - Components in transition render with B

t=2: Sync update to C happens mid-transition
     - Must show C to sync renders (new components mounting)
     - Must keep transition components on B until transition completes
     - Then transition components jump to C

     Without rebasing:
       ❌ Sync components show C
       ❌ Transition components stuck on B forever
       ❌ Inconsistent final state!

     With rebasing:
       ✅ committedSnapshot: C (sync renders)
       ✅ Notify sync
       ✅ pendingSnapshot: C
       ✅ startTransition(() => notify()) - transition catches up
       ✅ Consistent final state!
```

### 4. Component Mounting Strategy

The mounting strategy is counterintuitive but essential:

```typescript
const [snapshot, setSnapshot] = useState(() =>
  store.getPendingSnapshot()  // ← Why pending, not committed?!
)

useLayoutEffect(() => {
  const mountPending = store.getPendingSnapshot()
  const mountCommitted = store.getCommittedSnapshot()

  // Fix up if we mounted sync (not in transition)
  if (snapshot !== mountCommitted) {
    setSnapshot(mountCommitted)  // Sync update
  }

  // Entangle with transition if mounting mid-transition
  if (mountPending !== mountCommitted) {
    startTransition(() => {
      setSnapshot(mountPending)  // Transition update
    })
  }
}, [])
```

**Why mount with pending instead of committed?**

Consider this scenario:
```
startTransition(() => {
  // Transition is rendering with pending snapshot B
  // During this render, a new component mounts
})
```

**If we mounted with committed snapshot A:**
```
Render phase:
  - Mount with committed (A)
  - setState during render? ❌ Disallowed!

useLayoutEffect phase:
  - Transition already completed
  - Try to startTransition to entangle? ❌ Too late!
  - Component stuck on A while siblings show B
  - TEARING!
```

**Mounting with pending snapshot B:**
```
Render phase:
  - Mount with pending (B)
  - Matches other components in transition ✅

useLayoutEffect phase:
  - We're sync, should show committed (A)
  - setState(A) synchronously ✅
  - If transition still pending, also startTransition(B) ✅
  - Either way, synchronized correctly ✅
```

This is subtle but critical for preventing tearing!

### 5. StoreManager and Reference Counting

The StoreManager uses reference counting to handle component lifecycles:

```typescript
class StoreManager {
  _storeRefCounts: Map<CollectionStore, {
    count: number
    unsubscribe: () => void
  }>

  addStore(store) {
    const prev = this._storeRefCounts.get(store)
    if (prev == null) {
      // First component using this store
      this._storeRefCounts.set(store, {
        unsubscribe: store.subscribe(() => this.notify()),
        count: 1
      })
    } else {
      // Additional component using same store
      prev.count++
    }
  }

  removeStore(store) {
    const prev = this._storeRefCounts.get(store)
    // Don't unsubscribe yet! Just decrement
    prev.count--
    // Actual cleanup happens in sweep()
  }

  sweep() {
    for (const [store, refs] of this._storeRefCounts) {
      if (refs.count < 1) {
        refs.unsubscribe()
        this._storeRefCounts.delete(store)
      }
    }
  }
}
```

**Why defer cleanup in sweep()?**

Race condition to avoid:
```
Component A using store X unmounts
  → removeStore(X) → count=0 → unsubscribe immediately
Component B using store X mounts (same render)
  → addStore(X) → creates new subscription
  → ❌ Lost the committed snapshot during the gap!
  → ❌ Component B might see wrong state

Instead:
Component A unmounts → count--
Component B mounts → count++
After commit → sweep() → count > 0 → keep subscription ✅
```

### 6. CommitTracker Component

The CommitTracker orchestrates the commit process:

```typescript
const CommitTracker = memo(({ storeManager }) => {
  const [allSnapshots, setAllSnapshots] = useState(
    storeManager.getAllCommittedSnapshots()
  )

  useEffect(() => {
    // Subscribe to any store updates
    const unsubscribe = storeManager.subscribe(() => {
      // Capture all pending snapshots
      const pending = storeManager.getAllPendingSnapshots()
      setAllSnapshots(pending)
    })
    return () => {
      unsubscribe()
      storeManager.sweep()
    }
  }, [storeManager])

  useLayoutEffect(() => {
    // After React commits this render, commit all snapshots
    storeManager.commitAllSnapshots(allSnapshots)
  }, [storeManager, allSnapshots])

  return null
})
```

**How it works:**

1. **useEffect subscription**: Captures pending snapshots into state
2. **React renders**: Components see their appropriate snapshots
3. **useLayoutEffect commits**: After DOM updates, snapshots become committed
4. **sweep()**: Clean up unused stores

This creates a **feedback loop**:
```
Store updates → CommitTracker captures pending →
React renders with pending → DOM commits →
CommitTracker commits snapshots → Stores update committed state →
Next update cycle begins
```

### 7. Snapshot Caching Strategy

To avoid unnecessary re-renders, we cache the returned object:

```typescript
const returnedSnapshotRef = useRef<CollectionSnapshot | null>(null)
const returnedRef = useRef<any>(null)

if (returnedSnapshotRef.current !== snapshot) {
  // Snapshot changed - rebuild returned object
  returnedRef.current = {
    get state() {
      if (!stateCache) {
        stateCache = new Map(snapshot.entries)
      }
      return stateCache
    },
    get data() {
      if (!dataCache) {
        dataCache = snapshot.entries.map(([, value]) => value)
      }
      return singleResult ? dataCache[0] : dataCache
    },
    collection,
    status: snapshot.status,
    // ... other fields
  }
  returnedSnapshotRef.current = snapshot
}

return returnedRef.current
```

**Why lazy getters?**

```typescript
const result = useLiveQueryConcurrent(...)

// If user only accesses result.data:
result.data  // ✅ Creates dataCache array
// result.state is never accessed
// ✅ Never creates stateCache Map
// ✅ Saves memory and computation
```

### 8. Version Tracking

Versions ensure we can detect changes even if object identity is the same:

```typescript
private version: number = 0

private handleCollectionUpdate() {
  this.version += 1  // Always increment
  const newSnapshot = {
    entries: [...],
    status: '...',
    version: this.version  // Include in snapshot
  }
}
```

**Why versions matter:**

Without versions:
```typescript
// Collection has same data but status changed
const snapshot1 = { entries: [...], status: 'loading', version: 1 }
const snapshot2 = { entries: [...], status: 'ready', version: 2 }

if (snapshot1 === snapshot2) {
  // False! Object identity different
}

// But what if we tried to optimize by reusing objects?
// We need version to detect status-only changes
```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Initial mount | O(n) | n = collection entries |
| Update (no transition) | O(n) | Must copy entries for snapshot |
| Update (during transition) | O(n) | Two notifications |
| Component unmount | O(1) | Deferred to sweep |
| Sweep | O(m) | m = number of stores |

### Space Complexity

| Item | Space | Notes |
|------|-------|-------|
| Single snapshot | O(n) | n = collection entries |
| Dual snapshots | O(2n) | Pending + committed |
| Cached return value | O(n) | If both state and data accessed |
| StoreManager tracking | O(m) | m = number of stores |

### Optimization Opportunities

1. **Structural sharing**: Could reuse entry arrays when data hasn't changed
2. **Weak maps**: Could use WeakMap for store tracking
3. **Batching**: Could batch multiple store updates
4. **Suspense integration**: Could integrate with React Suspense for loading states

## Edge Cases Handled

### 1. Rapid Updates During Transition

```typescript
startTransition(() => {
  collection.update(1, draft => { draft.x = 1 })
  collection.update(2, draft => { draft.y = 2 })
  collection.update(3, draft => { draft.z = 3 })
})

// All updates batched in single transition
// Components render once with final state
```

### 2. Nested Transitions

```typescript
startTransition(() => {
  // Outer transition
  startTransition(() => {
    // Inner transition
    collection.update(...)
  })
})

// React handles transition nesting
// Store pic pattern follows React's lead
```

### 3. Transition Interruption

```typescript
startTransition(() => {
  setFilter('a')  // Start transition with 'a'
})

// User quickly changes mind
setFilter('b')  // Interrupts transition, forces sync

// Store handles gracefully:
// - Committed snapshot → 'b'
// - Pending snapshot → 'b'
// - Interrupted transition discarded
```

### 4. Store Reuse Across Components

```typescript
const store = new CollectionStore(collection)

function ComponentA() {
  useCollectionStore(store)  // ref count: 1
}

function ComponentB() {
  useCollectionStore(store)  // ref count: 2
}

// Both components share same store
// Reference counting prevents premature cleanup
```

## Limitations and Known Issues

### 1. Dynamic Stores Not Supported

```typescript
function MyComponent({ collectionId }) {
  const collection = getCollection(collectionId)
  const store = new CollectionStore(collection)

  // ❌ Error: dynamic stores not supported
  useCollectionStore(store)
}
```

**Reason**: Store identity must be stable for commit tracking to work.

**Workaround**: Create stores outside component or use useMemo.

### 2. Selector Changes Not Supported

```typescript
function MyComponent({ selector }) {
  // ❌ Error: dynamic selectors not supported
  useStoreSelector(store, selector)
}
```

**Reason**: Selector must be stable for caching to work correctly.

**Workaround**: Define selectors outside component or use useCallback.

### 3. Simplified Collection Rebasing

Unlike Redux (which has explicit actions and reducers), Collections are self-contained. The POC doesn't implement true "rebasing" of Collection mutations - it treats new collection state as both committed and pending.

**Implication**: In complex scenarios with Collection-level transactions or undo/redo, this simplification might not be sufficient.

### 4. React Internals Dependency

The `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` API is:
- Not officially supported
- Subject to change
- May break in future React versions

**Future**: React's official concurrent stores API will provide proper APIs.

## Testing Considerations

To test this POC thoroughly:

1. **Concurrent tearing tests**: Mount components mid-transition, verify no tearing
2. **State rebasing tests**: Trigger sync updates during transitions, verify order
3. **Reference counting tests**: Mount/unmount components, verify cleanup
4. **Performance tests**: Measure overhead vs useSyncExternalStore
5. **Edge case tests**: Interruptions, rapid updates, nested transitions

## Conclusion

The store pic pattern is a sophisticated approach to concurrent-safe external stores. While more complex than `useSyncExternalStore`, it provides genuine benefits for applications using React's concurrent features heavily.

The implementation balances:
- **Correctness**: Prevents tearing through careful state management
- **Performance**: Minimizes overhead through caching and lazy evaluation
- **Compatibility**: Works with existing Collections with minimal wrapping
- **Future-proofing**: Aligns with React's direction

The main trade-off is complexity - both in implementation and mental model. But for applications that need concurrent safety, this complexity is worthwhile.
