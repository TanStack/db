# TanStack DB - Code Snippets Reference

## 1. Collection Item Storage Pattern

### CollectionStateManager Overview
**File**: `/home/user/db/packages/db/src/collection/state.ts` (lines 29-78)

```typescript
export class CollectionStateManager<
  TOutput extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TInput extends object,
> {
  // Three layers of storage
  public syncedData: Map<TKey, TOutput> | SortedMap<TKey, TOutput>
  public optimisticUpserts = new Map<TKey, TOutput>()
  public optimisticDeletes = new Set<TKey>()
  public syncedMetadata = new Map<TKey, unknown>()

  constructor(config: CollectionConfig<TOutput, TKey, TSchema>) {
    // Set up data storage with optional comparison function
    if (config.compare) {
      this.syncedData = new SortedMap<TKey, TOutput>(config.compare)
    } else {
      this.syncedData = new Map<TKey, TOutput>()
    }
  }

  // Virtual derived state combining all layers
  public get(key: TKey): TOutput | undefined {
    const { optimisticDeletes, optimisticUpserts, syncedData } = this
    
    if (optimisticDeletes.has(key)) {
      return undefined
    }
    if (optimisticUpserts.has(key)) {
      return optimisticUpserts.get(key)
    }
    return syncedData.get(key)
  }
}
```

## 2. Mutation Data Structure

### PendingMutation Interface
**File**: `/home/user/db/packages/db/src/types.ts` (lines 57-86)

```typescript
export interface PendingMutation<
  T extends object = Record<string, unknown>,
  TOperation extends OperationType = OperationType,
  TCollection extends Collection<T, any, any, any, any> = Collection<
    T,
    any,
    any,
    any,
    any
  >,
> {
  mutationId: string                              // Unique ID for this mutation
  original: TOperation extends `insert` ? {} : T  // State before mutation
  modified: T                                     // State after mutation
  changes: ResolveTransactionChanges<T, TOperation> // Only changed fields
  globalKey: string                               // "KEY::{collectionId}/{key}"

  key: any                                        // Item's user-provided key
  type: TOperation                                // 'insert', 'update', or 'delete'
  metadata: unknown                               // Custom metadata
  syncMetadata: Record<string, unknown>           // Sync-provided metadata
  
  optimistic: boolean                             // Apply immediately?
  createdAt: Date                                 // When created
  updatedAt: Date                                 // Last updated
  collection: TCollection                         // Reference to collection
}
```

## 3. Global Key Generation

### How Global Keys Are Created
**File**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 143-149)

```typescript
public generateGlobalKey(key: any, item: any): string {
  if (typeof key === `undefined`) {
    throw new UndefinedKeyError(item)
  }
  // Format: KEY::{collectionId}/{key}
  return `KEY::${this.id}/${key}`
}
```

### Usage in Insert
**File**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 173-177)

```typescript
const key = this.config.getKey(validatedData)
if (this.state.has(key)) {
  throw new DuplicateKeyError(key)
}
const globalKey = this.generateGlobalKey(key, item)

const mutation: PendingMutation<TOutput, `insert`> = {
  mutationId: crypto.randomUUID(),
  globalKey,
  key,
  // ... other fields
}
```

## 4. Transaction Mutation Merging

### Merge Logic Truth Table
**File**: `/home/user/db/packages/db/src/transactions.ts` (lines 41-101)

```typescript
function mergePendingMutations<T extends object>(
  existing: PendingMutation<T>,
  incoming: PendingMutation<T>
): PendingMutation<T> | null {
  switch (`${existing.type}-${incoming.type}` as const) {
    case `insert-update`:
      // Update after insert: keep as insert but merge changes
      return {
        ...existing,
        type: `insert` as const,
        original: {},
        modified: incoming.modified,
        changes: { ...existing.changes, ...incoming.changes },
        key: existing.key,
        globalKey: existing.globalKey,
        mutationId: incoming.mutationId,
        updatedAt: incoming.updatedAt,
      }

    case `insert-delete`:
      // Delete after insert: cancel both mutations
      return null

    case `update-delete`:
      // Delete after update: delete dominates
      return incoming

    case `update-update`:
      // Update after update: replace with latest, union changes
      return {
        ...incoming,
        original: existing.original,
        changes: { ...existing.changes, ...incoming.changes },
      }

    case `delete-delete`:
    case `insert-insert`:
      // Same type: replace with latest
      return incoming
  }
}
```

### How Mutations Get Merged
**File**: `/home/user/db/packages/db/src/transactions.ts` (lines 323-345)

```typescript
applyMutations(mutations: Array<PendingMutation<any>>): void {
  for (const newMutation of mutations) {
    // Find existing mutation with same globalKey
    const existingIndex = this.mutations.findIndex(
      (m) => m.globalKey === newMutation.globalKey
    )

    if (existingIndex >= 0) {
      // Merge or remove if cancel
      const existingMutation = this.mutations[existingIndex]!
      const mergeResult = mergePendingMutations(existingMutation, newMutation)

      if (mergeResult === null) {
        // Remove the mutation (cancel)
        this.mutations.splice(existingIndex, 1)
      } else {
        // Replace with merged mutation
        this.mutations[existingIndex] = mergeResult
      }
    } else {
      // Insert new mutation
      this.mutations.push(newMutation)
    }
  }
}
```

## 5. Insert Operation

### Complete Insert Flow
**File**: `/home/user/db/packages/db/src/collection/mutations.ts` (lines 154-243)

```typescript
insert = (data: TInput | Array<TInput>, config?: InsertConfig) => {
  this.lifecycle.validateCollectionUsable(`insert`)
  const state = this.state
  const ambientTransaction = getActiveTransaction()

  // Check for handler
  if (!ambientTransaction && !this.config.onInsert) {
    throw new MissingInsertHandlerError()
  }

  const items = Array.isArray(data) ? data : [data]
  const mutations: Array<PendingMutation<TOutput>> = []

  // Create mutations for each item
  items.forEach((item) => {
    const validatedData = this.validateData(item, `insert`)
    const key = this.config.getKey(validatedData)
    
    if (this.state.has(key)) {
      throw new DuplicateKeyError(key)
    }
    
    const globalKey = this.generateGlobalKey(key, item)

    const mutation: PendingMutation<TOutput, `insert`> = {
      mutationId: crypto.randomUUID(),
      original: {},
      modified: validatedData,
      changes: Object.fromEntries(
        Object.keys(item).map((k) => [
          k,
          validatedData[k as keyof typeof validatedData],
        ])
      ) as TInput,
      globalKey,
      key,
      metadata: config?.metadata as unknown,
      syncMetadata: this.config.sync.getSyncMetadata?.() || {},
      optimistic: config?.optimistic ?? true,
      type: `insert`,
      createdAt: new Date(),
      updatedAt: new Date(),
      collection: this.collection,
    }

    mutations.push(mutation)
  })

  // If ambient transaction, use it; otherwise create one
  if (ambientTransaction) {
    ambientTransaction.applyMutations(mutations)
    state.transactions.set(ambientTransaction.id, ambientTransaction)
    state.scheduleTransactionCleanup(ambientTransaction)
    state.recomputeOptimisticState(true)
    return ambientTransaction
  } else {
    // Create transaction with onInsert handler
    const directOpTransaction = createTransaction<TOutput>({
      mutationFn: async (params) => {
        return await this.config.onInsert!({
          transaction: params.transaction as unknown as TransactionWithMutations<
            TOutput,
            `insert`
          >,
          collection: this.collection as unknown as Collection<TOutput, TKey>,
        })
      },
    })

    directOpTransaction.applyMutations(mutations)
    directOpTransaction.commit().catch(() => undefined)
    state.transactions.set(directOpTransaction.id, directOpTransaction)
    state.scheduleTransactionCleanup(directOpTransaction)
    state.recomputeOptimisticState(true)

    return directOpTransaction
  }
}
```

## 6. Transaction Lifecycle

### Transaction States
**File**: `/home/user/db/packages/db/src/transactions.ts` (lines 207-235)

```typescript
class Transaction<T extends object = Record<string, unknown>> {
  public id: string                              // UUID
  public state: TransactionState                 // pending|persisting|completed|failed
  public mutationFn: MutationFn<T>
  public mutations: Array<PendingMutation<T>>
  public isPersisted: Deferred<Transaction<T>>
  public autoCommit: boolean
  public createdAt: Date
  public sequenceNumber: number
  public metadata: Record<string, unknown>
  public error?: { message: string; error: Error }

  constructor(config: TransactionConfig<T>) {
    this.id = config.id ?? crypto.randomUUID()
    this.mutationFn = config.mutationFn
    this.state = `pending`
    this.mutations = []
    this.isPersisted = createDeferred<Transaction<T>>()
    this.autoCommit = config.autoCommit ?? true
    this.createdAt = new Date()
    this.sequenceNumber = sequenceNumber++
    this.metadata = config.metadata ?? {}
  }
}
```

### Commit Flow
**File**: `/home/user/db/packages/db/src/transactions.ts` (lines 468-514)

```typescript
async commit(): Promise<Transaction<T>> {
  if (this.state !== `pending`) {
    throw new TransactionNotPendingCommitError()
  }

  this.setState(`persisting`)

  if (this.mutations.length === 0) {
    this.setState(`completed`)
    this.isPersisted.resolve(this)
    return this
  }

  try {
    // Call the mutation function
    await this.mutationFn({
      transaction: this as unknown as TransactionWithMutations<T>,
    })

    this.setState(`completed`)
    this.touchCollection()
    this.isPersisted.resolve(this)
  } catch (error) {
    const originalError =
      error instanceof Error ? error : new Error(String(error))

    this.error = {
      message: originalError.message,
      error: originalError,
    }

    this.rollback()
    throw originalError
  }

  return this
}
```

## 7. Issue #19: Current Workaround

### Manual View Key Pattern
**File**: `/home/user/db/docs/guides/mutations.md` (lines 1130-1201)

```typescript
// User-maintained view key mapping
const idToViewKey = new Map<number | string, string>()

function getViewKey(id: number | string): string {
  if (!idToViewKey.has(id)) {
    idToViewKey.set(id, crypto.randomUUID())
  }
  return idToViewKey.get(id)!
}

function linkIds(tempId: number, realId: number) {
  const viewKey = getViewKey(tempId)
  idToViewKey.set(realId, viewKey)  // Link both IDs
}

const todoCollection = createCollection({
  id: "todos",
  onInsert: async ({ transaction }) => {
    const mutation = transaction.mutations[0]
    const tempId = mutation.modified.id

    const response = await api.todos.create(mutation.modified)
    const realId = response.id

    linkIds(tempId, realId)
    await todoCollection.utils.refetch()
  },
})

// Usage in render
const TodoList = () => {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection })
  )

  return (
    <ul>
      {todos.map((todo) => (
        <li key={getViewKey(todo.id)}>  // Stable key!
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

## 8. Key Type and Configuration

### Collection Configuration Type
**File**: `/home/user/db/packages/db/src/types.ts` (lines 385-595)

```typescript
export interface BaseCollectionConfig<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> {
  id?: string
  schema?: TSchema
  
  // REQUIRED: Extract ID from item
  getKey: (item: T) => TKey
  
  // Optional handlers
  onInsert?: InsertMutationFn<T, TKey, TUtils>
  onUpdate?: UpdateMutationFn<T, TKey, TUtils>
  onDelete?: DeleteMutationFn<T, TKey, TUtils>
  
  // Comparison for ordering
  compare?: (x: T, y: T) => number
  
  // Other options...
  gcTime?: number
  autoIndex?: `off` | `eager`
  startSync?: boolean
  syncMode?: SyncMode
  utils?: TUtils
}

export interface CollectionConfig<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> extends BaseCollectionConfig<T, TKey, TSchema, TUtils> {
  sync: SyncConfig<T, TKey>  // REQUIRED
}
```

