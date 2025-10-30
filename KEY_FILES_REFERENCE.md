# TanStack DB - Key Files Quick Reference

## File Location Map for Issue #19

### 1. Where Items Are Stored
- **File**: `/home/user/db/packages/db/src/collection/state.ts`
- **Key Classes**: `CollectionStateManager`
- **Storage Fields**:
  - `syncedData: Map<TKey, TOutput> | SortedMap<TKey, TOutput>` - Server truth
  - `optimisticUpserts: Map<TKey, TOutput>` - Pending changes
  - `optimisticDeletes: Set<TKey>` - Pending deletions
  - `syncedMetadata: Map<TKey, unknown>` - Metadata per item

### 2. How Mutations Are Structured
- **File**: `/home/user/db/packages/db/src/types.ts` (lines 57-86)
- **Interface**: `PendingMutation<T, TOperation, TCollection>`
- **Key Fields**:
  ```typescript
  mutationId: string                    // UUID
  key: any                              // User's item ID
  globalKey: string                     // "KEY::{collectionId}/{key}"
  modified: T                           // Final state
  changes: Partial<T>                   // Only changed fields
  original: T | {}                      // Pre-mutation state
  metadata: unknown                     // User metadata
  syncMetadata: Record<string, unknown> // Sync metadata
  optimistic: boolean                   // Apply immediately?
  type: 'insert' | 'update' | 'delete'  // Operation type
  ```

### 3. How Transactions Work
- **File**: `/home/user/db/packages/db/src/transactions.ts`
- **Key Class**: `Transaction<T>`
- **Merging Logic**: `mergePendingMutations()` (lines 41-101)
- **Key Methods**:
  - `applyMutations()` - Add/merge mutations (lines 323-345)
  - `commit()` - Persist to backend (lines 468-514)
  - `rollback()` - Revert changes (lines 385-410)

### 4. Insert/Update/Delete Operations
- **File**: `/home/user/db/packages/db/src/collection/mutations.ts`
- **Key Class**: `CollectionMutationsManager`
- **Key Methods**:
  - `insert()` - Create new items (lines 154-243)
  - `update()` - Modify items (lines 248-438)
  - `delete()` - Remove items (lines 443-538)
- **Global Key Generation**: `generateGlobalKey()` (lines 143-149)

### 5. Type Definitions
- **File**: `/home/user/db/packages/db/src/types.ts`
- **Key Exports**:
  - `PendingMutation<T>` - Mutation structure
  - `TransactionConfig<T>` - Transaction options
  - `ChangeMessage<T>` - Change event structure
  - `BaseCollectionConfig<T, TKey>` - Collection options
  - `OperationType` - 'insert' | 'update' | 'delete'

## Critical Concepts for Issue #19

### Current ID/Key Model
1. **User provides**: `getKey: (item: T) => TKey`
2. **TKey type**: string | number
3. **Key immutability**: Updates cannot change the key (throws error)
4. **Global key format**: `KEY::{collectionId}/{key}` used for deduplication

### The View Key Problem
- **Issue**: Temporary IDs become real IDs during sync
- **Current workaround**: Manual mapping in user code
- **Goal**: Automate this with built-in view keys

### Proposed Solution Sketch
1. Add optional `viewKey?: string` to `PendingMutation`
2. Generate viewKey on insert in `CollectionMutationsManager.insert()`
3. Maintain `viewKeyMap: Map<TKey, string>` in `CollectionStateManager`
4. Link temp ID viewKey to real ID viewKey in sync operations
5. Expose `getViewKey(key: TKey): string` on collection

## Key Data Structures to Understand

### SortedMap
- **File**: `/home/user/db/packages/db/src/SortedMap.ts`
- **Use**: Optional ordered storage of items
- **Created when**: `config.compare` function provided
- **Time complexity**: O(log n) insertion via binary search

### Change Proxy
- **File**: `/home/user/db/packages/db/src/proxy.ts`
- **Purpose**: Tracks changes to items using Immer-like pattern
- **Used in**: `update()` method to capture property changes

### Event System
- **File**: `/home/user/db/packages/db/src/collection/changes.ts`
- **Class**: `CollectionChangesManager`
- **Emits**: `ChangeMessage<T>` events for mutations

## Testing Files (for reference)
Located in: `/home/user/db/packages/db/tests/`

Useful test patterns:
- Collection creation and basic operations
- Mutation merging behavior
- Transaction lifecycle
- Sync operations
- State management

## Related Files Not Yet Explored
- **Sync operations**: `/home/user/db/packages/db/src/collection/sync.ts`
- **Query system**: `/home/user/db/packages/db/src/query/`
- **Index management**: `/home/user/db/packages/db/src/indexes/`
- **LocalStorage collection**: `/home/user/db/packages/db/src/local-storage.ts`

