# TanStack DB Codebase Structure - Issue #19 Exploration

## Executive Summary

Issue #19 focuses on implementing **stable view keys** for handling temporary-to-real ID transitions when inserting items where the server generates the final ID. Currently, this requires manual mapping outside the collection.

## Directory Structure

```
/home/user/db/packages/db/src/
├── collection/
│   ├── index.ts                    # Main Collection implementation
│   ├── state.ts                    # CollectionStateManager - core item storage
│   ├── mutations.ts                # CollectionMutationsManager - insert/update/delete
│   ├── transactions.ts             # NOT HERE - see root
│   ├── changes.ts                  # CollectionChangesManager - event emission
│   ├── change-events.ts            # Change event generation
│   ├── lifecycle.ts                # Collection lifecycle management
│   ├── sync.ts                     # CollectionSyncManager - sync operations
│   ├── subscription.ts             # Subscription management
│   ├── events.ts                   # Event emission
│   └── indexes.ts                  # IndexesManager - query optimization
├── transactions.ts                  # Transaction implementation (mutation grouping)
├── types.ts                        # Type definitions (PendingMutation, Transaction, etc.)
├── local-storage.ts                # LocalStorage collection implementation
├── proxy.ts                        # Change tracking proxy system
├── SortedMap.ts                    # Ordered Map implementation
├── event-emitter.ts                # Event system
├── scheduler.ts                    # Async scheduler
├── utils.ts                        # Utilities
└── indexes/                        # Index implementations
    ├── base-index.ts
    ├── btree-index.ts
    ├── lazy-index.ts
    └── ...
```

---

## 1. Collection Item Storage

### Primary Storage Structure

**Location**: `/home/user/db/packages/db/src/collection/state.ts` (CollectionStateManager)

```typescript
// Main stores
public syncedData: Map<TKey, TOutput> | SortedMap<TKey, TOutput>
public optimisticUpserts = new Map<TKey, TOutput>()
public optimisticDeletes = new Set<TKey>()
public syncedMetadata = new Map<TKey, unknown>()
```

**Storage Layers**:
1. **`syncedData`**: Source of truth from the server
   - Regular `Map<TKey, TOutput>` if no comparator provided
   - `SortedMap<TKey, TOutput>` if a `compare` function is provided
   - Contains confirmed items from sync operations

2. **`optimisticUpserts`**: Pending insert/update items
   - Overlays syncedData
   - Cleared when transactions complete/fail
   - Re-added if still active

3. **`optimisticDeletes`**: Items pending deletion
   - Set of keys marked for deletion
   - Checked in the virtual `get()` method

### Virtual Derived State Access

```typescript
// Constructor (lines 73-77)
if (config.compare) {
  this.syncedData = new SortedMap<TKey, TOutput>(config.compare)
} else {
  this.syncedData = new Map<TKey, TOutput>()
}

// Combined view (lines 95-109)
public get(key: TKey): TOutput | undefined {
  if (optimisticDeletes.has(key)) return undefined
  if (optimisticUpserts.has(key)) return optimisticUpserts.get(key)
  return syncedData.get(key)
}
```

**Ordering**:
1. Check optimistic deletes (returns undefined)
2. Check optimistic upserts (returns optimistic value)
3. Fall back to synced data

---

## 2. Transaction and Mutation Implementation

### Mutation Data Structure

**Location**: `/home/user/db/packages/db/src/types.ts` (lines 57-86)

```typescript
export interface PendingMutation<T, TOperation, TCollection> {
  mutationId: string                    // UUID for the specific mutation
  original: T | {}                      // Pre-mutation state (empty for inserts)
  modified: T                           // Post-mutation state
  changes: ResolveTransactionChanges    // Only actual changes (for partial updates)
  globalKey: string                     // KEY::{collectionId}/{key} - for deduplication
  
  key: any                              // User's item key (from getKey())
  type: 'insert' | 'update' | 'delete'  // Operation type
  
  metadata: unknown                     // User-provided metadata
  syncMetadata: Record<string, unknown>  // Metadata from sync operations
  
  optimistic: boolean                   // Apply changes immediately? (default: true)
  createdAt: Date                       // When mutation was created
  updatedAt: Date                       // Last update time
  
  collection: Collection<T>             // Reference to collection
}
```

### Global Key Generation

**Location**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 143-149)

```typescript
public generateGlobalKey(key: any, item: any): string {
  if (typeof key === `undefined`) {
    throw new UndefinedKeyError(item)
  }
  // Format: KEY::{collectionId}/{key}
  return `KEY::${this.id}/${key}`
}
```

**Purpose**: 
- Uniquely identifies an item across transactions
- Used to merge mutations on the same item
- Supports deduplication and transaction merging logic

### Transaction Structure

**Location**: `/home/user/db/packages/db/src/transactions.ts` (lines 207-530)

```typescript
class Transaction<T> {
  public id: string                      // UUID for transaction
  public state: TransactionState          // 'pending' | 'persisting' | 'completed' | 'failed'
  public mutationFn: MutationFn<T>       // Persistence function
  public mutations: Array<PendingMutation<T>>  // Grouped mutations
  public isPersisted: Deferred<Transaction<T>> // Promise for completion
  public autoCommit: boolean              // Auto-commit after mutate()
  public createdAt: Date
  public sequenceNumber: number          // For ordering transactions
  public metadata: Record<string, unknown>
  public error?: { message: string; error: Error }
}
```

### Mutation Merging Logic

**Location**: `/home/user/db/packages/db/src/transactions.ts` (lines 41-101)

**Truth Table**:
```
Existing → New | Result  | Behavior
insert → update | insert  | Merge changes, keep empty original
insert → delete | removed | Cancel each other
update → delete | delete  | Delete dominates
update → update | update  | Union changes, keep first original
delete → delete | delete  | Replace with latest
insert → insert | insert  | Replace with latest
```

**Key Algorithm** (lines 323-345):
```typescript
applyMutations(mutations: Array<PendingMutation<any>>): void {
  for (const newMutation of mutations) {
    // Find existing mutation with same globalKey
    const existingIndex = this.mutations.findIndex(
      (m) => m.globalKey === newMutation.globalKey
    )
    
    if (existingIndex >= 0) {
      // Merge or remove if cancel
      const mergeResult = mergePendingMutations(existing, newMutation)
      if (mergeResult === null) {
        this.mutations.splice(existingIndex, 1)  // Cancel
      } else {
        this.mutations[existingIndex] = mergeResult  // Replace
      }
    } else {
      this.mutations.push(newMutation)  // New mutation
    }
  }
}
```

---

## 3. ID and Key Management

### Current Key Handling

**Location**: `/home/user/db/packages/db/src/types.ts` (lines 400-409)

```typescript
interface BaseCollectionConfig<T, TKey, TSchema, TUtils> {
  getKey: (item: T) => TKey  // REQUIRED: Extract ID from item
  // ... other config
}
```

**Key Properties**:
- `TKey`: Type of the key (string | number)
- User provides `getKey()` function at collection creation
- Used to:
  - Extract key from item for storage
  - Generate globalKey
  - Validate key changes are not allowed in updates
  - Track mutations by item identity

### Key Validation

**Location**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 340-346)

```typescript
// Check if ID is being changed (not allowed)
const originalItemId = this.config.getKey(originalItem)
const modifiedItemId = this.config.getKey(modifiedItem)

if (originalItemId !== modifiedItemId) {
  throw new KeyUpdateNotAllowedError(originalItemId, modifiedItemId)
}
```

### Sync Metadata

**Location**: `/home/user/db/packages/db/src/collection/state.ts` (lines 47, 367)

```typescript
public syncedMetadata = new Map<TKey, unknown>()

// Used in mutations (line 367-370)
syncMetadata: (state.syncedMetadata.get(key) || {}) as Record<string, unknown>
```

**Purpose**:
- Stores metadata associated with synced items
- Separate from user-provided metadata
- Can be set via `sync.getSyncMetadata()`

---

## 4. Type Definitions

### Key Type Interfaces

**Location**: `/home/user/db/packages/db/src/types.ts`

#### OperationType (line 152)
```typescript
export type OperationType = `insert` | `update` | `delete`
```

#### Transaction Configuration (lines 115-123)
```typescript
export interface TransactionConfig<T> {
  id?: string
  autoCommit?: boolean
  mutationFn: MutationFn<T>
  metadata?: Record<string, unknown>
}
```

#### Change Message (lines 261-270)
```typescript
export interface ChangeMessage<T, TKey> {
  key: TKey
  value: T
  previousValue?: T
  type: OperationType
  metadata?: Record<string, unknown>
}
```

#### Operation Handlers (lines 496-583)
```typescript
// Insert handler
onInsert?: InsertMutationFn<T, TKey, TUtils, TReturn>

// Update handler
onUpdate?: UpdateMutationFn<T, TKey, TUtils, TReturn>

// Delete handler
onDelete?: DeleteMutationFn<T, TKey, TUtils, TReturn>
```

---

## 5. Extended Properties and Metadata

### Metadata Patterns

**User Metadata** (provided at operation time):
```typescript
// In mutations
collection.update(id, 
  { metadata: { intent: 'complete' } },  // Custom metadata
  (draft) => { draft.completed = true }
)

// Accessible in handler
const mutation = transaction.mutations[0]
console.log(mutation.metadata?.intent)  // 'complete'
```

**Sync Metadata** (from sync implementation):
```typescript
// Set by sync in getSyncMetadata()
sync: {
  getSyncMetadata?: () => Record<string, unknown>
  // ...
}

// Accessible in mutation
const syncMeta = mutation.syncMetadata
```

### Timestamps

**Location**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 198-199, 373-374)

```typescript
createdAt: new Date()  // When mutation created
updatedAt: new Date()  // Last update in transaction
```

**Note**: These track mutation lifecycle, not item timestamps.

---

## 6. Issue #19: Stable View Keys

### The Problem

**Location**: `/home/user/db/docs/guides/mutations.md` (lines 1045-1070)

When inserting items with temporary IDs (before server assigns real IDs):

1. **UI Flicker**: Framework unmounts/remounts components when key changes from temporary to real ID
2. **Subsequent Operations Fail**: Delete/update before sync completes uses invalid temporary ID

```typescript
// Current problematic pattern
const tempId = -(Math.floor(Math.random() * 1000000) + 1)
todoCollection.insert({ id: tempId, text: 'New todo' })
// When sync completes, tempId becomes realId
todoCollection.delete(tempId)  // May fail: tempId no longer exists
```

### Current Workaround (Manual)

**Location**: `/home/user/db/docs/guides/mutations.md` (lines 1130-1201)

```typescript
// User must maintain this mapping manually
const idToViewKey = new Map<number | string, string>()

function getViewKey(id: number | string): string {
  if (!idToViewKey.has(id)) {
    idToViewKey.set(id, crypto.randomUUID())
  }
  return idToViewKey.get(id)!
}

function linkIds(tempId: number, realId: number) {
  const viewKey = getViewKey(tempId)
  idToViewKey.set(realId, viewKey)  // Link both IDs to same key
}

// In handler
onInsert: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const tempId = mutation.modified.id
  const response = await api.todos.create(mutation.modified)
  linkIds(tempId, response.id)
  await todoCollection.utils.refetch()
}

// In render
{todos.map((todo) => (
  <li key={getViewKey(todo.id)}>  // Stable key!
    {todo.text}
  </li>
))}
```

### Issue Request

**Location**: `/home/user/db/docs/guides/mutations.md` (line 1211)

> There's an [open issue](https://github.com/TanStack/db/issues/19) to add better built-in support for temporary ID handling in TanStack DB. This would automate the view key pattern and make it easier to work with server-generated IDs.

---

## 7. Key Files Summary

| File | Purpose | Key Exports |
|------|---------|------------|
| `types.ts` | Type definitions | `PendingMutation`, `TransactionConfig`, `ChangeMessage`, etc. |
| `transactions.ts` | Transaction management | `Transaction`, `createTransaction()`, `mergePendingMutations()` |
| `collection/state.ts` | Item storage & state | `CollectionStateManager` with `syncedData`, `optimisticUpserts`, `optimisticDeletes` |
| `collection/mutations.ts` | Insert/update/delete logic | `CollectionMutationsManager` with `insert()`, `update()`, `delete()`, `generateGlobalKey()` |
| `collection/index.ts` | Main collection class | `Collection`, `CollectionImpl`, `createCollection()` |
| `collection/changes.ts` | Event emission | `CollectionChangesManager`, event batching & emission |
| `local-storage.ts` | localStorage implementation | `localStorageCollectionOptions()` with persistence |
| `proxy.ts` | Change tracking | `createChangeProxy()`, Immer-like change tracking |
| `SortedMap.ts` | Ordered storage | `SortedMap<K, V>` with binary search insertion |

---

## 8. Data Flow for Mutations

```
1. User calls collection.insert/update/delete()
   ↓
2. CollectionMutationsManager creates PendingMutation
   - Generates globalKey: KEY::{collectionId}/{key}
   - Sets metadata, timestamps
   - Validates against schema
   ↓
3. Mutation added to active Transaction
   - Can be ambient or explicit transaction
   - If same globalKey exists: merge via mergePendingMutations()
   ↓
4. Transaction.mutate() completes or autoCommit triggers
   ↓
5. Transaction.commit() calls mutationFn()
   - Sends mutations to backend
   - User's onInsert/onUpdate/onDelete called
   ↓
6. On success: sync operations update syncedData
   - Optimistic state cleared
   - Server state becomes truth
   - Change events emitted
   ↓
7. On failure: transaction.rollback()
   - Optimistic state reverted
   - Change events emitted
```

---

## 9. Implications for Issue #19 Fix

### Where View Key Storage Would Go

1. **Option A**: Add to `PendingMutation`
   ```typescript
   viewKey?: string  // Stable key for rendering
   ```

2. **Option B**: Add to CollectionStateManager
   ```typescript
   public viewKeyMap = new Map<TKey, string>()  // Maps both temp and real IDs
   ```

3. **Option C**: Add to collection config
   ```typescript
   generateViewKey?: (item: T, mutation: PendingMutation) => string
   ```

### Key Modification Points

1. **In `mutations.ts`**: 
   - Generate/track viewKey during insert creation
   - Link viewKey when key changes detected

2. **In `state.ts`**:
   - Maintain viewKey mapping through lifecycle
   - Provide `getViewKey()` public method

3. **In `types.ts`**:
   - Add viewKey to `PendingMutation`
   - Add viewKey to `ChangeMessage`
   - Add config option to `BaseCollectionConfig`

4. **In sync operations**:
   - When synced item replaces optimistic item, link viewKeys
   - Preserve viewKey through state transitions

### Critical Behaviors to Preserve

1. **Key immutability**: Still enforce in updates
2. **Mutation merging**: Use original key, not viewKey
3. **Backward compatibility**: viewKey optional, default to key
4. **Performance**: viewKey lookup O(1) with Map

---

## References

- **Main collection implementation**: `/home/user/db/packages/db/src/collection/index.ts`
- **State management**: `/home/user/db/packages/db/src/collection/state.ts`
- **Mutation handling**: `/home/user/db/packages/db/src/collection/mutations.ts`
- **Transaction logic**: `/home/user/db/packages/db/src/transactions.ts`
- **Type definitions**: `/home/user/db/packages/db/src/types.ts`
- **Documentation**: `/home/user/db/docs/guides/mutations.md` (lines 1045-1211)
