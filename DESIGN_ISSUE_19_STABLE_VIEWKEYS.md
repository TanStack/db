# Design: Stable ViewKeys for Temporary ID Transitions (Issue #19)

## Problem Statement

When inserting items with temporary IDs (before server assigns real IDs), two critical UX issues occur:

1. **UI Flicker**: React unmounts/remounts components when the key changes from temporary to real ID
2. **Operation Failures**: Subsequent operations (delete/update) fail if they use the temporary ID before sync completes

Currently, developers must manually maintain a mapping from IDs to stable view keys, which is error-prone and boilerplate-heavy.

## Goals

1. **Automatic**: View keys should be automatically generated and tracked by collections
2. **Opt-in**: Backward compatible - only used when explicitly requested
3. **Simple API**: Easy to use with minimal boilerplate
4. **Type-safe**: Fully typed with good TypeScript support
5. **Performant**: O(1) lookups with no significant memory overhead

## Design Overview

### 1. Core Storage: ViewKey Mapping

Add a `viewKeyMap` to `CollectionStateManager` that maintains stable view keys across ID transitions:

```typescript
// In collection/state.ts
export class CollectionStateManager<T, TKey, TOutput, TUtils> {
  // Existing storage
  public syncedData: Map<TKey, TOutput> | SortedMap<TKey, TOutput>
  public optimisticUpserts = new Map<TKey, TOutput>()
  public optimisticDeletes = new Set<TKey>()
  public syncedMetadata = new Map<TKey, unknown>()

  // NEW: ViewKey mapping
  public viewKeyMap = new Map<TKey, string>()  // Maps both temp and real IDs to stable viewKey
}
```

### 2. Collection Configuration (Opt-in)

Add optional `viewKey` configuration to enable the feature:

```typescript
// In types.ts
interface BaseCollectionConfig<T, TKey, TSchema, TUtils> {
  // Existing config...
  getKey: (item: T) => TKey

  // NEW: ViewKey configuration (opt-in)
  viewKey?: {
    // Auto-generate view keys on insert
    generate?: (item: T) => string

    // Or always use a specific field from the item as viewKey
    field?: keyof T
  }
}
```

**Usage patterns:**

```typescript
// Pattern 1: Auto-generate UUIDs (most common)
const todoCollection = createCollection({
  id: "todos",
  getKey: (item) => item.id,
  viewKey: {
    generate: () => crypto.randomUUID()  // Auto-generate stable keys
  },
})

// Pattern 2: Use existing stable field (like a UUID field separate from ID)
const postCollection = createCollection({
  id: "posts",
  getKey: (item) => item.id,
  viewKey: {
    field: 'uuid'  // Use item.uuid as viewKey
  },
})

// Pattern 3: No viewKey (backward compatible - defaults to using key as viewKey)
const userCollection = createCollection({
  id: "users",
  getKey: (item) => item.id,
  // No viewKey config - uses key directly (current behavior)
})
```

### 3. ViewKey Generation on Insert

Automatically generate view keys when items are inserted:

```typescript
// In collection/mutations.ts - CollectionMutationsManager.insert()
public insert(
  item: T | T[],
  options?: { metadata?: unknown; optimistic?: boolean }
): Transaction<any> {
  const items = Array.isArray(item) ? item : [item]

  return this.withTransaction((transaction) => {
    const mutations = items.map((item) => {
      const key = this.config.getKey(item)

      // NEW: Generate viewKey if configured
      let viewKey: string | undefined
      if (this.config.viewKey) {
        if (this.config.viewKey.generate) {
          viewKey = this.config.viewKey.generate(item)
        } else if (this.config.viewKey.field) {
          viewKey = String(item[this.config.viewKey.field])
        }

        // Store viewKey mapping
        if (viewKey) {
          this.state.viewKeyMap.set(key, viewKey)
        }
      }

      // Create mutation with viewKey
      const mutation: PendingMutation<T> = {
        // ... existing fields
        viewKey,  // NEW field
        // ... rest
      }

      return mutation
    })

    // ... rest of insert logic
  })
}
```

### 4. ViewKey Linking API

Provide a new method to link temporary IDs to real IDs during sync:

```typescript
// In collection/mutations.ts - CollectionMutationsManager
public linkViewKeys(mapping: { tempKey: TKey; realKey: TKey }[]): void {
  mapping.forEach(({ tempKey, realKey }) => {
    const viewKey = this.state.viewKeyMap.get(tempKey)
    if (viewKey) {
      // Link real key to the same viewKey
      this.state.viewKeyMap.set(realKey, viewKey)
      // Keep temp key mapping for brief period (helps with race conditions)
      // Could optionally delete tempKey after a delay
    }
  })
}
```

**Alternative: Auto-detect ID transitions** (more magical but potentially fragile):

```typescript
// In collection/state.ts - during sync
private detectIdTransitions(syncedItems: T[]): void {
  // Detect when optimistic item with tempId is replaced by synced item with realId
  // This would compare optimistic items to incoming synced items by content similarity
  // More complex but requires no manual linking
}
```

### 5. Public API: getViewKey()

Expose a method to retrieve view keys for rendering:

```typescript
// In collection/index.ts - Collection interface
interface Collection<T, TKey> {
  // Existing methods...
  insert(item: T | T[], options?: InsertOptions): Transaction
  update(key: TKey | TKey[], ...): Transaction
  delete(key: TKey | TKey[], ...): Transaction

  // NEW: Get stable viewKey for an item
  getViewKey(key: TKey): string
}

// Implementation in CollectionImpl
public getViewKey(key: TKey): string {
  // Return mapped viewKey if exists, otherwise fall back to key
  const viewKey = this.state.viewKeyMap.get(key)
  return viewKey ?? String(key)
}
```

### 6. Include ViewKey in Change Events

Add viewKey to change messages so subscribers can use stable keys:

```typescript
// In types.ts
export interface ChangeMessage<T, TKey> {
  key: TKey
  value: T
  previousValue?: T
  type: OperationType
  metadata?: Record<string, unknown>
  viewKey?: string  // NEW: Stable view key for rendering
}

// In collection/change-events.ts - when emitting changes
const changeMessage: ChangeMessage<T, TKey> = {
  key,
  value,
  previousValue,
  type: 'insert',
  metadata: mutation.metadata,
  viewKey: mutation.viewKey ?? this.getViewKey(key),  // Include viewKey
}
```

### 7. PendingMutation Type Update

Add viewKey to mutation type:

```typescript
// In types.ts
export interface PendingMutation<T, TOperation, TCollection> {
  // Existing fields...
  mutationId: string
  original: T | {}
  modified: T
  changes: ResolveTransactionChanges
  globalKey: string
  key: any
  type: 'insert' | 'update' | 'delete'
  metadata: unknown
  syncMetadata: Record<string, unknown>
  optimistic: boolean
  createdAt: Date
  updatedAt: Date
  collection: Collection<T>

  // NEW: Stable view key
  viewKey?: string
}
```

## Usage Examples

### Example 1: Basic Usage with Auto-Generated ViewKeys

```typescript
import { createCollection, queryCollectionOptions } from '@tanstack/react-db'

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: async () => api.todos.getAll(),
    getKey: (item) => item.id,

    // Enable auto-generated view keys
    viewKey: {
      generate: () => crypto.randomUUID()
    },

    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      const tempId = mutation.modified.id

      // Create on server
      const response = await api.todos.create(mutation.modified)
      const realId = response.id

      // Link temporary ID to real ID
      todoCollection.linkViewKeys([{ tempKey: tempId, realKey: realId }])

      // Wait for sync
      await todoCollection.utils.refetch()
    },
  })
)

// In component
function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection })
  )

  return (
    <ul>
      {todos.map((todo) => (
        // Use stable viewKey instead of id
        <li key={todoCollection.getViewKey(todo.id)}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}

// Insert with temporary ID
const tempId = -Date.now()
todoCollection.insert({
  id: tempId,
  text: 'New todo',
  completed: false,
})

// Delete immediately (works even before sync completes)
todoCollection.delete(tempId)  // Uses same temp key, no 404
```

### Example 2: Using Existing UUID Field

```typescript
interface Post {
  id: number          // Server-generated sequential ID
  uuid: string        // Client-generated UUID (stable)
  title: string
}

const postCollection = createCollection({
  id: "posts",
  getKey: (item) => item.id,

  // Use existing uuid field as viewKey
  viewKey: {
    field: 'uuid'
  },

  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0]
    const tempId = mutation.modified.id

    const response = await api.posts.create(mutation.modified)

    // Link temp ID to real ID
    postCollection.linkViewKeys([{ tempKey: tempId, realKey: response.id }])

    await postCollection.utils.refetch()
  },
})

// Insert with both temp ID and stable UUID
postCollection.insert({
  id: -Date.now(),          // Temporary ID
  uuid: crypto.randomUUID(), // Stable UUID for viewKey
  title: 'New Post',
})
```

### Example 3: Batch Insert with Multiple ID Mappings

```typescript
const batchInsertTodos = async (texts: string[]) => {
  // Create temp items with viewKeys
  const tempItems = texts.map(text => ({
    id: -Date.now() - Math.random(),
    text,
    completed: false,
  }))

  // Insert optimistically
  const tx = todoCollection.insert(tempItems)

  // Persist to server
  const response = await api.todos.batchCreate(tempItems)

  // Link all temp IDs to real IDs
  const mappings = tempItems.map((item, index) => ({
    tempKey: item.id,
    realKey: response[index].id,
  }))

  todoCollection.linkViewKeys(mappings)

  // Sync back
  await todoCollection.utils.refetch()

  await tx.isPersisted.promise
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Required for MVP)

1. **Add viewKeyMap to CollectionStateManager**
   - File: `packages/db/src/collection/state.ts`
   - Add: `public viewKeyMap = new Map<TKey, string>()`

2. **Add viewKey to PendingMutation type**
   - File: `packages/db/src/types.ts`
   - Add: `viewKey?: string` to `PendingMutation` interface

3. **Add viewKey config to BaseCollectionConfig**
   - File: `packages/db/src/types.ts`
   - Add: `viewKey?: { generate?: (item: T) => string; field?: keyof T }` to config

4. **Implement viewKey generation in insert()**
   - File: `packages/db/src/collection/mutations.ts`
   - Update `insert()` method to generate and store viewKeys

5. **Add getViewKey() public method**
   - File: `packages/db/src/collection/index.ts`
   - Expose `getViewKey(key: TKey): string` on Collection interface

6. **Add linkViewKeys() method**
   - File: `packages/db/src/collection/mutations.ts`
   - Implement `linkViewKeys(mapping: Array<{ tempKey: TKey; realKey: TKey }>): void`

### Phase 2: Change Events (Nice to have)

7. **Include viewKey in ChangeMessage**
   - File: `packages/db/src/types.ts`
   - Add: `viewKey?: string` to `ChangeMessage` interface

8. **Emit viewKey in change events**
   - File: `packages/db/src/collection/change-events.ts`
   - Include viewKey when creating change messages

### Phase 3: Documentation & Testing

9. **Update mutations.md documentation**
   - Replace manual workaround with new built-in API
   - Add examples and best practices

10. **Add tests**
    - Test viewKey generation
    - Test linkViewKeys() with temp → real ID transitions
    - Test getViewKey() fallback behavior
    - Test backward compatibility (no viewKey config)

## Backward Compatibility

- **No breaking changes**: All new features are opt-in
- **Default behavior unchanged**: Collections without `viewKey` config work as before
- **Graceful fallback**: `getViewKey()` returns `String(key)` when no viewKey is configured

## Alternative Approaches Considered

### Alternative 1: Auto-detect ID transitions

**Pros:**
- No manual linking required
- More "magical" DX

**Cons:**
- Complex heuristics needed to match optimistic items to synced items
- Risk of false positives/negatives
- Hard to debug when detection fails
- Performance overhead

**Decision:** Rejected in favor of explicit linking for reliability

### Alternative 2: Add viewKey field to items themselves

**Pros:**
- Simpler storage (no separate map)
- ViewKey persists with item data

**Cons:**
- Pollutes user's data model
- Requires schema changes
- Not backward compatible
- ViewKey would sync to server unnecessarily

**Decision:** Rejected - keep viewKey in collection metadata

### Alternative 3: Transaction-level viewKey API

```typescript
transaction.mapViewKey({ tempId, realId })
```

**Pros:**
- Transaction-scoped (matches issue proposal)

**Cons:**
- Less discoverable API
- Requires transaction reference
- Less flexible (what if user wants to link outside transaction?)

**Decision:** Use collection-level API for better discoverability

## Open Questions

1. **ViewKey cleanup**: Should we automatically remove viewKey mappings for temp IDs after they're replaced?
   - **Recommendation**: Keep temp mapping for ~1 second to handle race conditions, then clean up

2. **ViewKey persistence**: Should viewKeys persist to localStorage for LocalStorageCollection?
   - **Recommendation**: Yes, store viewKeyMap alongside data for consistency

3. **ViewKey in queries**: Should query results include viewKey automatically?
   - **Recommendation**: No, keep it opt-in via `getViewKey()`. Queries return data as-is.

4. **Multiple temp → real transitions**: What if an item's ID changes multiple times?
   - **Recommendation**: viewKey stays stable across all transitions (that's the point!)

## Success Criteria

1. Users can enable viewKey generation with single config option
2. Temp → real ID transitions don't cause UI flicker
3. `getViewKey()` provides stable keys for React rendering
4. Zero breaking changes to existing codebases
5. Documentation clearly explains usage and best practices

## Timeline Estimate

- **Phase 1 (Core)**: 2-3 days (6 changes)
- **Phase 2 (Events)**: 1 day (2 changes)
- **Phase 3 (Docs/Tests)**: 1-2 days
- **Total**: 4-6 days for full implementation

## Related Issues

- Issue #19: https://github.com/TanStack/db/issues/19
- Documentation: /home/user/db/docs/guides/mutations.md (lines 1045-1211)
