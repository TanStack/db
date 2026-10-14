---
title: Error Handling
id: error-handling
---

TanStack DB provides comprehensive error handling capabilities to ensure robust data synchronization and state management. This guide covers the built-in error handling mechanisms and how to work with them effectively.

## Error Types

TanStack DB provides named error classes for better error handling and type safety. All error classes can be imported from `@tanstack/db` (or more commonly, the framework-specific package e.g. `@tanstack/react-db`):

```ts
import {
  SchemaValidationError,
  CollectionInErrorStateError,
  DuplicateKeyError,
  MissingHandlerError,
  TransactionError,
  // ... and many more
} from "@tanstack/db"
```

### SchemaValidationError

Thrown when data doesn't match the collection's schema during insert or update operations:

```ts
import { SchemaValidationError } from "@tanstack/db"

try {
  todoCollection.insert({ text: 123 }) // Invalid type
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.log(error.type) // 'insert' or 'update'
    console.log(error.issues) // Array of validation issues
    // Example issue: { message: "Expected string, received number", path: ["text"] }
  }
}
```

The error includes:
- `type`: Whether it was an 'insert' or 'update' operation
- `issues`: Array of validation issues with messages and paths
- `message`: A formatted error message listing all issues

**When schema validation occurs:**

Schema validation happens only for **client mutations** - when you explicitly insert or update data:

1. **During inserts** - When `collection.insert()` is called
2. **During updates** - When `collection.update()` is called

Schemas do **not** validate data coming from your server or sync layer. That data is assumed to already be valid.

```typescript
const schema = z.object({
  id: z.string(),
  created_at: z.string().transform(val => new Date(val))
  // TInput: string, TOutput: Date
})

// Validation happens here ✓
collection.insert({
  id: "1",
  created_at: "2024-01-01"  // TInput: string
})
// If successful, stores: { created_at: Date }  // TOutput: Date
```

For more details on schema validation and type transformations, see the [Schemas guide](./schemas.md).

## Query Collection Error Tracking

Query collections provide enhanced error tracking utilities through the `utils` object. These methods expose error state information and provide recovery mechanisms for failed queries:

```tsx
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { useLiveQuery } from "@tanstack/react-db"

const syncedCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ['synced-data'],
    queryFn: fetchData,
    getKey: (item) => item.id,
  })
)

// Component can check error state
function DataList() {
  const { data } = useLiveQuery({
    query: (q) => q.from({ item: syncedCollection }),
  })
  const isError = syncedCollection.utils.isError
  const errorCount = syncedCollection.utils.errorCount
  
  return (
    <>
      {isError && errorCount > 3 && (
        <Alert>
          Unable to sync. Showing cached data.
          <button onClick={() => syncedCollection.utils.clearError()}>
            Retry
          </button>
        </Alert>
      )}
      {/* Render data */}
    </>
  )
}
```

Error tracking methods:
- **`lastError`**: Returns the most recent error encountered by the query, or `undefined` if no errors have occurred since a successful result applied:
- **`isError`**: Returns a boolean indicating whether the collection is currently in an error state:
- **`errorCount`**: Returns the number of consecutive sync failures. This counter is incremented only when queries fail completely (not per retry attempt) and is reset after a successful result applies:
- **`clearError()`**: Triggers a refetch. The current error remains visible until a successful result applies to the Collection. An applied result clears `lastError` and resets `errorCount`; a failed retry records another consecutive failure and rejects the returned promise. During a mutation handler, the promise can resolve at the fetch boundary before application clears the error:

  ```text
  error visible → clearError() → retry pending, error still visible
                                   ├─ applied success → error cleared
                                   └─ failure → new error visible, count increased
  ```

## Incremental Subset Load Errors

An incremental `loadSubset` failure does not discard rows that are already
available or put the shared source collection into `error`. The failure belongs
to the subscription that requested that subset:

```ts
const subscription = todoCollection.subscribeChanges(handleChanges, {
  includeInitialState: false,
})

subscription.on('loadSubset:error', ({ error, options }) => {
  console.error('Subset failed', options, error)
})

subscription.requestSnapshot()

// The most recent failure remains available for diagnostics.
console.log(subscription.lastError)
```

For ordered live queries, `utils.setWindow()` rejects with the same error. The
last failure is also available as `utils.lastSubsetError`, while the last
successful snapshot remains readable:

```ts
try {
  await liveTodos.utils.setWindow({ offset: 0, limit: 100 })
} catch (error) {
  console.error(liveTodos.utils.lastSubsetError)
}
```

Effects report subset failures through `onSourceError` and dispose because
their incremental result can no longer be kept complete.

When a source change invalidates an ordered window, automatic full-source
repair keeps the last complete snapshot visible. A failed repair exposes
`utils.lastSubsetError` and retries at most twice, after 250 ms and 500 ms.
Exhausting those retries does not put an already-ready query into a terminal
error state or clear its rows. The app can show the error and explicitly retry
with `setWindow()`. Cleanup or truncate cancels the old repair timer. Failed
imperative window moves and initial loads do not use this background retry.

For SQLite-persisted on-demand collections, a failed upstream `loadSubset`
rejects even when hydration succeeded. Cached rows remain readable; their
availability does not mean the remote request succeeded. Background coordinator
retry, where supported, does not change the failed caller's outcome.

When a must-refetch truncate cannot reload every active subset, a subscription
keeps its last successful snapshot and reports the subset error. It discards
the incomplete replay batch and keeps later source changes private because they
cannot prove a complete replacement. The next truncate retries every active
subset. Overlapping truncates form one atomic replay: all in-flight requests
settle, the newest attempt decides the result, and subscribers receive the
replacement only when that attempt succeeds. Cleanup rejects window moves that
are waiting for replay with `AbortError`.

## Collection Status and Error States

A Collection and every live query over it answer two separate questions:

| Question | Where to look | Changes when |
| --- | --- | --- |
| Can this data be shown, or must the query restart? | `status`, `isReady`, `isError` | During the initial load of a sync run, or when a Collection crashes |
| Is this data still kept up to date? | `errors` (the error tree) | When a sync adapter reports a problem or recovers, or a request for more data fails |

```tsx
import { useLiveQuery } from "@tanstack/react-db"

const TodoList = () => {
  const { data, isError, isLoading, errors } = useLiveQuery((query) =>
    query.from({ todos: todoCollection })
  )

  if (isLoading) return <div>Loading...</div>
  if (isError) return <div>Todos failed to load</div>

  return (
    <>
      {errors?.hasErrors && <div>Todos may be out of date.</div>}
      {data.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </>
  )
}
```

Collection status values:
- `idle` - Not yet started
- `loading` - Loading initial data
- `ready` - Ready for use
- `error` - The sync run failed; only a restart recovers
- `cleaned-up` - Cleaned up; a new preload or subscriber restarts it

### The initial load

Until a Collection has its first usable snapshot, its status is `loading`.
While its sync adapter retries, it stays `loading`. When the sync adapter gives
up, the status becomes `error`, readiness waits such as `preload()` reject with
the original cause, and every live query and Effect that depends on the
Collection fails too.

An initial error is final for its sync run. TanStack DB does not retry it, and
a later successful sync does not move the Collection back to `ready`. To try
again, restart the query:

```ts
await todosQuery.cleanup()
await todosQuery.preload()
```

### After the first ready

Once the data has loaded, it stays. When the sync adapter later loses its
connection or a refresh fails, `status` stays `ready` and the rows stay, even
as they grow stale. The problem appears in `errors` and in
`collection.health` instead. The sync adapter clears it when sync works again,
unless the error is final: a final error means the sync adapter stopped
trying, and only a restart clears it.

> **Important:** `isError` does not report these problems. To show a "this data
> may be out of date" banner, check `errors.hasErrors`.

### When a Collection crashes

A few failures leave a Collection unable to serve reads or accept writes: a
closed IndexedDB connection, a failed write to local SQLite persistence, or an
internal invariant failure. The Collection then moves to `error` even after it
was ready, and so does every live query and Effect above it. These failures are
rare, and they mean storage is broken. Recover the same way as from an initial
error: clean up and restart.

### The error tree

Every live query result includes `errors`. It has the same shape for a given
query: one node for the live query and one node for each source alias, in query
order. Healthy nodes are present too, with `isError: false`. A disabled query
has no query definition, so its `errors` is `undefined`.

```ts
type ErrorTreeNode = {
  alias: string // the query alias, or "root"
  collectionId: string
  kind: "source" | "live-query" | "include"
  status: CollectionStatus
  isError: boolean // this node has a problem now
  hasErrors: boolean // this node or any node below it
  error: CollectionErrorInfo | null
  instances?: { total: number; inError: number } // include nodes only
  sources: Array<ErrorTreeNode>
}

type CollectionErrorInfo = {
  phase: "initial" | "sync" | "request"
  final: boolean // the sync adapter stopped trying; only a restart clears it
  name: string
  message: string
  code?: string
  at: number // epoch milliseconds
  cause: unknown // the original value; omitted from JSON
}
```

The phases:

- `initial`: the Collection's sync run failed, by an initial error or a crash.
  Its `status` is `error`.
- `sync`: the sync adapter reported a problem after the Collection was ready.
- `request`: a request for more data, such as the next page or a newly
  joined row, failed after the query was ready. The source Collection stays
  healthy. The error clears when that data loads, or when the query stops
  needing it.

A Collection used twice in one query, for example in a self-join, has one node
per alias. An include has one node for all of its per-row child Collections,
with `instances` counting how many are in error. A nested live query's node
carries its own sources.

The tree keeps its object identity until something in it changes, so you can
pass it to `useMemo` or compare it with `===`. Apart from `cause`, it is plain
data that you can log or send:

```ts
useEffect(() => {
  if (errors?.hasErrors) reportToMonitoring(JSON.parse(JSON.stringify(errors)))
}, [errors])
```

Server-side rendering does not transfer `errors`; the client builds its own
tree from its own sync.

### Effects

An Effect follows the same rules. A source that fails its initial load, or
that crashes, disposes the Effect through `onSourceError`. Any other problem
after the Effect's initial load does not dispose it. Subscribe to it instead:

```ts
createEffect({
  query: (q) => q.from({ order: orders }),
  onBatch: (events) => {
    /* ... */
  },
  onHealthChange: (errors) => {
    if (errors.hasErrors) pauseAutomations()
    else resumeAutomations()
  },
})
```

### Using Suspense and Error Boundaries (React)

For React applications, you can handle loading and error states with `useLiveSuspenseQuery`, React Suspense, and Error Boundaries:

```tsx
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

const TodoList = () => {
  const { data, errors } = useLiveSuspenseQuery((query) =>
    query.from({ todos: todoCollection })
  )

  // data is always defined here
  return (
    <>
      {errors?.hasErrors && <div>Todos may be out of date.</div>}
      {data.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </>
  )
}

const App = () => (
  <ErrorBoundary fallback={<div>Failed to load todos</div>}>
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  </ErrorBoundary>
)
```

`<Suspense>` handles the initial load and `<ErrorBoundary>` handles an initial
error. After the first render, the hook does not throw, as in TanStack Query:
problems appear in `errors`, and a crash sets `isError` while the last data
stays on screen. See the [React Suspense section in Live Queries](./live-queries#using-with-react-suspense) for more details.

When every eager SQLite persisted source opts in, a failed client query stream can produce a different initial result. React waits for every persisted restore. If each restore succeeds, React renders the query result. A derived-query failure still reaches the Error Boundary. See [Render after SQLite restore](./sqlite-persistence.md#render-after-sqlite-restore) for the option and its limits.

## Transaction Error Handling

When mutations fail, TanStack DB automatically rolls back optimistic updates:

```ts
const todoCollection = createCollection({
  id: "todos",
  onInsert: async ({ transaction }) => {
    const response = await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify(transaction.mutations[0].modified),
    })
    
    if (!response.ok) {
      // Throwing an error will rollback the optimistic state
      throw new Error(`HTTP Error: ${response.status}`)
    }
    
    return response.json()
  },
})

// Usage - optimistic update will be rolled back if the mutation fails
try {
  const tx = todoCollection.insert({
    id: "1",
    text: "New todo",
    completed: false,
  })
  
  await tx.when('settled')
} catch (error) {
  // The optimistic update has been automatically rolled back
  console.error("Failed to create todo:", error)
}
```

### Transaction States and Error Information

Transactions have the following states:
- `pending` - Transaction is being processed
- `persisting` - Currently executing the mutation function
- `completed` - Transaction completed successfully
- `failed` - Transaction failed and was rolled back

Access transaction error information from collection operations:

```ts
const todoCollection = createCollection({
  id: "todos",
  onUpdate: async ({ transaction }) => {
    const response = await fetch(`/api/todos/${transaction.mutations[0].key}`, {
      method: "PUT",
      body: JSON.stringify(transaction.mutations[0].modified),
    })
    
    if (!response.ok) {
      throw new Error(`Update failed: ${response.status}`)
    }
  },
})

try {
  const tx = await todoCollection.update("todo-1", (draft) => {
    draft.completed = true
  })
  
  await tx.when('settled')
} catch (error) {
  // Transaction has been rolled back
  console.log(tx.state) // "failed"
  console.log(tx.error) // { message: "Update failed: 500", error: Error }
}
```

Or with manual transaction creation:

```ts
const tx = createTransaction({
  mutationFn: async ({ transaction }) => {
    throw new Error("API failed")
  }
})

tx.mutate(() => {
  collection.insert({ id: "1", text: "Item" })
})

try {
  await tx.commit()
} catch (error) {
  // Transaction has been rolled back
  console.log(tx.state) // "failed"
  console.log(tx.error) // { message: "API failed", error: Error }
}
```

Explicit cancellation is different from a mutation failure. If you call
`tx.rollback()` while `mutationFn` is pending, the rollback settles
`tx.when('settled')` as rejected. A later result or rejection from that
mutation function is ignored: the outstanding `commit()` call resolves and
`tx.error` is not populated by that late rejection. Observe `tx.when('settled')`
when you need the transaction's outcome, including explicit cancellation.

After the mutation function succeeds, a publication listener can still throw
while the completed transaction updates its collections. In that case
`commit()` rejects with the listener error, but `tx.when('settled')` resolves
and the transaction remains completed. This is not a persistence failure.

## Collection Operation Errors

### Invalid Collection State

Collections in an `error` state, after an initial error or a crash, cannot perform operations and must be restarted:

```ts
import { CollectionInErrorStateError } from "@tanstack/db"

try {
  todoCollection.insert(newTodo)
} catch (error) {
  if (error instanceof CollectionInErrorStateError) {
    // Collection needs to be cleaned up and restarted
    await todoCollection.cleanup()
    await todoCollection.preload()
    
    // Now retry the operation
    todoCollection.insert(newTodo)
  }
}
```

If a live query depends on this Collection, restart both Collections as shown
in [Collection Cleanup and Restart](#collection-cleanup-and-restart).

### Missing Mutation Handlers

Direct mutations require handlers to be configured:

```ts
const todoCollection = createCollection({
  id: "todos",
  getKey: (todo) => todo.id,
  // Missing onInsert handler
})

// This will throw an error
todoCollection.insert(newTodo)
// Error: Collection.insert called directly (not within an explicit transaction) but no 'onInsert' handler is configured
```

### Insert Operation Errors

#### DuplicateKeyError

Thrown when inserting items with existing keys:

```ts
import { DuplicateKeyError } from "@tanstack/db"

try {
  todoCollection.insert({ id: "existing-id", text: "Todo" })
} catch (error) {
  if (error instanceof DuplicateKeyError) {
    console.log(`Duplicate key: ${error.message}`)
    // Consider using update() instead, or check if item exists first
  }
}
```

#### UndefinedKeyError

Thrown when an object is created without a defined key:

```ts
import { UndefinedKeyError } from "@tanstack/db"

const collection = createCollection({
  id: "todos",
  getKey: (item) => item.id,
})

try {
  collection.insert({ text: "Todo" }) // Missing 'id' field
} catch (error) {
  if (error instanceof UndefinedKeyError) {
    console.log("Item is missing required key field")
    // Ensure your items have the key field defined by getKey
  }
}
```

### Update Operation Errors

#### UpdateKeyNotFoundError

Thrown when trying to update a key that doesn't exist in the collection:

```ts
import { UpdateKeyNotFoundError } from "@tanstack/db"

try {
  todoCollection.update("nonexistent-key", draft => {
    draft.completed = true
  })
} catch (error) {
  if (error instanceof UpdateKeyNotFoundError) {
    console.log("Key not found - item may have been deleted")
    // Consider using insert() if the item doesn't exist
  }
}
```

#### KeyUpdateNotAllowedError

Thrown when attempting to change an item's key (not allowed - delete and re-insert instead):

```ts
import { KeyUpdateNotAllowedError } from "@tanstack/db"

try {
  todoCollection.update("todo-1", draft => {
    draft.id = "todo-2" // Not allowed!
  })
} catch (error) {
  if (error instanceof KeyUpdateNotAllowedError) {
    console.log("Cannot change item keys")
    // Instead, delete the old item and insert a new one
  }
}
```

### Delete Operation Errors

#### DeleteKeyNotFoundError

Thrown when trying to delete a key that doesn't exist:

```ts
import { DeleteKeyNotFoundError } from "@tanstack/db"

try {
  todoCollection.delete("nonexistent-key")
} catch (error) {
  if (error instanceof DeleteKeyNotFoundError) {
    console.log("Key not found - item may have already been deleted")
    // This may be acceptable in some scenarios (idempotent deletes)
  }
}
```

## Sync Error Handling

### Query Collection Sync Errors

Query collections distinguish an initial load failure from a later refetch failure:

```ts
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["todos"],
    queryFn: async () => {
      const response = await fetch("/api/todos")
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }
      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
    schema: todoSchema,
    // Standard TanStack Query error handling options
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })
)
```

When sync errors occur:
- Error is logged to console: `[QueryCollection] Error observing query...`
- An initial failure marks the collection as `error` because no usable snapshot exists
- Readiness waits such as `preload()` and `toArrayWhenReady()` reject with the cause passed to `markError(error)` while the collection is in that initial error state
- A later refetch failure keeps the collection `ready` and preserves its cached data, and reports a health error that is not final, because TanStack Query fetches again
- Error tracking counters are updated (`lastError`, `errorCount`); after the collection is ready, `collection.health` and the `errors` tree mirror `lastError`
- A later successful refetch clears `lastError` and the health error, but it does not move an initial `error` collection back to `ready`; restart it with `cleanup()` and `preload()`

### Sync Write Errors

Sync functions must handle their own errors during write operations:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ begin, write, commit }) => {
      begin()
      
      try {
        // Will throw if key already exists
        write({ type: "insert", value: { id: "existing-id", text: "Todo" } })
      } catch (error) {
        // Error: Cannot insert document with key "existing-id" from sync because it already exists
      }
      
      commit()
    }
  }
})
```

### Cleanup Error Handling

Cleanup errors are isolated to prevent blocking the cleanup process:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ begin, commit }) => {
      begin()
      commit()
      
      // Return a cleanup function
      return () => {
        // If this throws, the error is re-thrown in a microtask
        // but cleanup continues successfully
        throw new Error("Sync cleanup failed")
      }
    },
  },
})

// Cleanup completes even if the sync cleanup function throws
await collection.cleanup() // Resolves successfully
// Error is re-thrown asynchronously via queueMicrotask
```

## Error Recovery Patterns

### Collection Cleanup and Restart

Cleanup ends the current sync run and releases the resources installed by its
`sync()` call. A later access can start a new sync run. If no live query or
Effect depends on the source Collection, restart it like this:

```ts
if (todoCollection.status === "error") {
  // Cleanup ends the current sync run and resets the collection
  await todoCollection.cleanup()
  
  // Start a new sync run and wait for readiness
  await todoCollection.preload()
}
```

Cleaning up a source Collection while a live-query Collection depends on it
puts that live query in a terminal error state. Restarting the source alone
does not revive the live query. If you own both Collections, clean up the
dependent live query first. Preloading it after source cleanup starts fresh
sync runs for both Collections and waits for the query's required data:

```ts
const todosQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todoCollection }),
)
await todosQuery.preload()

// Later, if todoCollection enters an error state:
await todosQuery.cleanup()
await todoCollection.cleanup()
await todosQuery.preload()
```

The same `todosQuery` object and its subscribers can receive later source
updates after this sequence. A framework hook that creates its own live-query
Collection may retain it across renders or remounts. Use a pre-created
live-query Collection when you need to control this cleanup and restart
sequence. A successful preload establishes Collection readiness; whether the
source has caught up with a remote service depends on its sync adapter.
Cleanup also disposes dependent Effects; recreate them after the source restarts.

### Graceful Degradation

After the first ready, Collections keep working with their rows when sync
fails. The error tree tells you which source has the problem and whether its
sync adapter is still trying:

```tsx
const TodoApp = () => {
  const { data, errors } = useLiveQuery((query) =>
    query.from({ todos: todoCollection })
  )
  const todosError = errors?.sources[0]?.error

  return (
    <div>
      {todosError && (
        <div>
          {todosError.final
            ? "Sync stopped. Reload to try again."
            : "Reconnecting. Showing saved data."}
        </div>
      )}
      {data.map((todo) => <TodoItem key={todo.id} todo={todo} />)}
    </div>
  )
}
```

### Transaction Rollback Cascading

When a transaction fails, conflicting transactions are automatically rolled back:

```ts
const tx1 = createTransaction({ mutationFn: async () => {} })
const tx2 = createTransaction({ mutationFn: async () => {} })

tx1.mutate(() => collection.update("1", draft => { draft.value = "A" }))
tx2.mutate(() => collection.update("1", draft => { draft.value = "B" })) // Same item

// Rolling back tx1 will also rollback tx2 due to conflict
tx1.rollback() // tx2 is automatically rolled back
```

### Transaction Lifecycle Errors

Transactions validate their state before operations to prevent misuse. Here are the specific errors you may encounter:

#### MissingMutationFunctionError

Thrown when creating a transaction without a required `mutationFn`:

```ts
import { MissingMutationFunctionError } from "@tanstack/db"

try {
  const tx = createTransaction({}) // Missing mutationFn
} catch (error) {
  if (error instanceof MissingMutationFunctionError) {
    console.log("mutationFn is required when creating a transaction")
  }
}
```

#### TransactionNotPendingMutateError

Thrown when calling `mutate()` after a transaction is no longer pending:

```ts
import { TransactionNotPendingMutateError } from "@tanstack/db"

const tx = createTransaction({ mutationFn: async () => {} })

await tx.commit()

try {
  tx.mutate(() => {
    collection.insert({ id: "1", text: "Item" })
  })
} catch (error) {
  if (error instanceof TransactionNotPendingMutateError) {
    console.log("Cannot mutate - transaction is no longer pending")
  }
}
```

#### TransactionNotPendingCommitError

Thrown when calling `commit()` after a transaction is no longer pending:

```ts
import { TransactionNotPendingCommitError } from "@tanstack/db"

const tx = createTransaction({ mutationFn: async () => {} })
tx.mutate(() => collection.insert({ id: "1", text: "Item" }))

await tx.commit()

try {
  await tx.commit() // Trying to commit again
} catch (error) {
  if (error instanceof TransactionNotPendingCommitError) {
    console.log("Transaction already committed")
  }
}
```

#### TransactionAlreadyCompletedRollbackError

Thrown when calling `rollback()` on a transaction that's already completed:

```ts
import { TransactionAlreadyCompletedRollbackError } from "@tanstack/db"

const tx = createTransaction({ mutationFn: async () => {} })
tx.mutate(() => collection.insert({ id: "1", text: "Item" }))

await tx.commit()

try {
  tx.rollback() // Can't rollback after commit
} catch (error) {
  if (error instanceof TransactionAlreadyCompletedRollbackError) {
    console.log("Cannot rollback - transaction already completed")
  }
}
```

### Sync Transaction Errors

When working with sync transactions, these errors can occur:

#### NoPendingSyncTransactionWriteError

Thrown when calling `write()` without an active sync transaction:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ write }) => {
      // Calling write without begin() first
      write({ type: "insert", value: { id: "1", text: "Todo" } })
      // Error: No pending sync transaction to write to
    }
  }
})
```

#### SyncTransactionAlreadyCommittedWriteError

Thrown when calling `write()` after the sync transaction is already committed:

```ts
const collection = createCollection({
  id: "todos",
  sync: {
    sync: ({ begin, write, commit }) => {
      begin()
      commit()

      // Trying to write after commit
      write({ type: "insert", value: { id: "1", text: "Todo" } })
      // Error: The pending sync transaction is already committed
    }
  }
})
```

#### NoPendingSyncTransactionCommitError

Thrown when calling `commit()` without an active sync transaction.

#### SyncTransactionAlreadyCommittedError

Thrown when calling `commit()` on a sync transaction that's already committed.

## Best Practices

1. **Use instanceof checks** - Use `instanceof` instead of string matching for error handling:
   ```ts
   // ✅ Good - type-safe error handling
   if (error instanceof SchemaValidationError) {
     // Handle validation error
   }
   
   // ❌ Avoid - brittle string matching  
   if (error.message.includes("validation failed")) {
     // Handle validation error
   }
   ```

2. **Import specific error types** - Import only the error classes you need for better tree-shaking
3. **Always handle SchemaValidationError** - Provide clear feedback for validation failures
4. **Check both axes** - Use `isLoading` and `isError` for whether data can be shown, and `errors.hasErrors` for whether it may be stale
5. **Handle transaction promises** - Always handle `when('settled')` rejections

## Example: Complete Error Handling

```tsx
import {
  createCollection,
  createLiveQueryCollection,
  SchemaValidationError,
  DuplicateKeyError,
  UpdateKeyNotFoundError,
  DeleteKeyNotFoundError,
  TransactionNotPendingCommitError,
  createTransaction
} from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"

const todoCollection = createCollection({
  id: "todos",
  schema: todoSchema,
  getKey: (todo) => todo.id,
  onInsert: async ({ transaction }) => {
    const response = await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify(transaction.mutations[0].modified),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  },
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      // Your sync implementation
      begin()
      // ... sync logic
      commit()
      markReady()
    }
  }
})

const todosQuery = createLiveQueryCollection((query) =>
  query.from({ todos: todoCollection })
)

const TodoApp = () => {
  const { data, isError, isLoading, errors } = useLiveQuery(todosQuery)

  const handleAddTodo = async (text: string) => {
    try {
      const tx = await todoCollection.insert({
        id: crypto.randomUUID(),
        text,
        completed: false,
      })
      
      // Wait for persistence
      await tx.when('settled')
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        alert(`Validation error: ${error.issues[0]?.message}`)
      } else if (error instanceof DuplicateKeyError) {
        alert("A todo with this ID already exists")
      } else {
        alert(`Failed to add todo: ${error.message}`)
      }
    }
  }

  const handleRestart = async () => {
    try {
      await todosQuery.cleanup()
      await todoCollection.cleanup()
      await todosQuery.preload()
    } catch (error) {
      alert(`Failed to restart todos: ${String(error)}`)
    }
  }

  if (isError) {
    return (
      <div>
        <div>Todos could not load</div>
        <button onClick={handleRestart}>Restart Collections</button>
      </div>
    )
  }

  if (isLoading) {
    return <div>Loading todos...</div>
  }

  return (
    <div>
      {errors?.hasErrors && <div>Todos may be out of date</div>}
      <button onClick={() => handleAddTodo("New todo")}>
        Add Todo
      </button>
      {data.map((todo) => (
        <div key={todo.id}>{todo.text}</div>
      ))}
    </div>
  )
}
```

## See Also

- [API Reference](../overview.md#api-reference) - Detailed API documentation
- [Mutations Guide](../overview.md#making-optimistic-mutations) - Learn about optimistic updates and rollbacks
- [TanStack Query Error Handling](https://tanstack.com/query/latest/docs/react/guides/error-handling) - Query-specific error handling
