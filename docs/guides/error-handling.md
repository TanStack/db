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

Query Collections report failures through the error tree, like every other
Collection. A `queryFn` failure before the first successful result fails the
first load: the status is `error`, and `preload()` rejects with the cause. Set
`retry` so that a short outage is retried inside that first load. After the
first result, a failed refetch sets the source node's `failureReason`, because
TanStack Query fetches again. The rows stay, and the next successful result
clears it:

```tsx
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { useLiveQuery } from "@tanstack/react-db"

const syncedCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ["synced-data"],
    queryFn: fetchData,
    getKey: (item) => item.id,
    retry: 3,
  })
)

function DataList() {
  const { data, isSyncError } = useLiveQuery((q) =>
    q.from({ item: syncedCollection })
  )

  return (
    <>
      {isSyncError && (
        <Alert>
          Unable to sync. Showing cached data.
          <button
            onClick={() => syncedCollection.utils.refetch({ throwOnError: true })}
          >
            Retry
          </button>
        </Alert>
      )}
      {/* Render data */}
    </>
  )
}
```

`utils.refetch({ throwOnError: true })` retries and rejects when the retry
fails. The `failureReason` stays visible while the retry is pending. During a
mutation handler, the promise can resolve at the fetch boundary before the
result applies and clears it.

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

## Loading and Sync Errors

An app that shows synced data asks two questions:

1. **Can I show the data?** Read `status`.
2. **Is the data on screen still being kept up to date?** Read `isSyncError` and `errors`.

TanStack DB answers them separately. Once a query has shown data, a network or
backend failure never takes the data off the screen. It shows up in `errors`,
and the rows stay.

```tsx
import { eq, findProblems } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"

function TaskList() {
  const {
    data,
    isLoading,
    isLoadingError,
    isCrashed,
    isSyncError,
    errors,
    collection,
  } = useLiveQuery((q) =>
    q
      .from({ task: tasks })
      .join({ user: users }, ({ task, user }) => eq(task.assigneeId, user.id))
  )

  if (isLoading) return <Spinner />
  if (isLoadingError) return <LoadFailed onRetry={() => collection.reload()} />
  if (isCrashed) return <StorageBroken />

  return (
    <>
      {isSyncError && (
        <SyncBanner errors={errors} onReload={() => collection.reload()} />
      )}
      {data.map((row) => (
        <TaskRow key={row.task.id} {...row} />
      ))}
    </>
  )
}
```

### Status

| `status` | Flag | Meaning | What the app does |
| --- | --- | --- | --- |
| `idle` | `isIdle` | Sync has not started. | Nothing yet. |
| `loading` | `isLoading` | The first data is on its way. | Show a placeholder. |
| `ready` | `isReady` | The data can be shown. | Show it. Check `isSyncError` for a banner. |
| `error` | `isLoadingError` | The first load failed. There is nothing to show. | Show a failure screen and offer `reload()`. |
| `crashed` | `isCrashed` | Local storage broke. This Collection cannot be used again. | Recreate the Collection (see [When a Collection crashes](#when-a-collection-crashes)). |
| `cleaned-up` | `isCleanedUp` | The Collection was cleaned up. | Nothing. |

Two rules make `status` predictable:

- **After a query has shown data, only a crash changes its status.** A dropped
  connection, a failed refetch, or a backend that stops answering appears in
  `errors`. `isLoadingError` therefore always means "nothing to show yet".
- **A query takes the worst status of its sources until it is ready.** If any
  source fails its first load, the query's status is `error`, and `preload()`
  rejects with the cause.

`isError` is removed. Use `isLoadingError` and `isCrashed`, which need
different handling.

### Sync errors: the `errors` tree

`errors` has one node for the query itself and one for each source in the
query, in query order. The tree's shape is fixed by the query, so you can
render, log, or send it to monitoring. A disabled query has no query
definition, so its `errors` is `undefined`.

```ts
{
  alias: "root", kind: "live-query", status: "ready", hasErrors: true,
  failureReason: null, error: null, reloading: false,
  sources: [
    { alias: "task", kind: "source", status: "ready", hasErrors: false,
      failureReason: null, error: null, reloading: false, sources: [] },
    { alias: "user", kind: "source", status: "ready", hasErrors: true,
      failureReason: { name: "FetchError", message: "Network request failed", at: 1760342400000 },
      error: null, reloading: false, sources: [] },
  ],
}
```

A node can show one of two problems. They follow TanStack Query's
`failureReason` and `error`:

| Field | Meaning | What the app does |
| --- | --- | --- |
| `failureReason` | Something went wrong, and the sync adapter is still trying. It clears by itself when sync works again. | Show "Reconnecting…" or nothing. Wait. |
| `error` | The sync adapter stopped, or the first load failed. The rows from this source stay but no longer update. | Show "Updates stopped" and offer `reload()`. |

`isSyncError` is `true` when the query is `ready` and any node has a
`failureReason` or an `error`. `hasErrors` on a node says whether that node or
any node below it has one.

Each problem is `{ name, message, code?, at, cause }`. `cause` holds the exact
value the adapter reported, for example the `Response` or the error your
`queryFn` threw. Every other field is plain JSON. A node keeps its object
identity until something in its part of the tree changes, so `===` and
`useMemo` work on it. Server-side rendering does not transfer `errors`; the
client builds its own tree from its own sync.

`failureReason` says that the adapter is trying, not that trying will help. An
expired token gives a `failureReason` on every refetch until the user signs in.
Use `code` or `cause` for cases like this:

```tsx
import { findProblems, type ErrorTreeNode } from "@tanstack/db"

function SyncBanner({
  errors,
  onReload,
}: {
  errors: ErrorTreeNode
  onReload: () => void
}) {
  const [first] = findProblems(errors) // nodes with a problem, in query order
  if (first?.failureReason?.code === "401") return <SignInAgain />
  if (first?.error) return <UpdatesStopped onReload={onReload} />
  return <Reconnecting />
}
```

`findProblems(errors)` walks the tree and returns every node that has a
problem of its own, in query order. Use it for the message on a failure screen
too: when `isLoadingError` is true, the first node it returns holds the first
load failure in its `error`.

A Collection used twice in one query, for example in a self-join, has one node
per alias. An include has one node, which shows the include's source; its
per-row child Collections are not in the tree. A nested live query's node
carries its own sources.

### Collections without a live query

Every Collection has the same surface, so code that uses a Collection directly
does not need a live query:

```ts
todos.status // 'loading' | 'ready' | 'error' | 'crashed' | ...
todos.errors // one node: { status, failureReason, error, reloading, ... }
todos.on("errors:change", ({ collection }) => report(collection.errors))
await todos.reload()
```

A live query is a Collection too; its `errors` is the whole tree.

### Failed requests for more data

After a query is ready it can ask for more data: the next page of an infinite
query, or rows for a newly joined key. When that request fails, the query's own
node (`root`) shows an `error`. The sources stay healthy and the rows already
shown stay. The error clears when the data loads, or when the query no longer
needs it, for example after the user scrolls back.

```tsx
const { data, errors, fetchNextPage } = useLiveInfiniteQuery(/* ... */)

{
  errors?.error && (
    <button onClick={() => fetchNextPage()}>Retry loading more</button>
  )
}
```

### Reloading

`collection.reload()` starts a new sync run for a Collection. It works like a
sync-side truncate: nothing visible changes until the new run's first commit.

- The current rows, `status`, and any `error` stay on screen. The node shows
  `reloading: true`.
- When the new run commits, its rows replace the old rows in one change, and
  the node's problem clears. A Collection in `error` becomes `ready` when the
  new run calls `markReady()`.
- If the new run fails, the old rows and status stay, the node shows the new
  `error`, and the `reload()` promise rejects.

On a live query, `reload()` reloads each of its sources that has an `error`,
then the query itself if it failed its first load. To reload one source
instead, call `reload()` on that source's Collection; a query in `error`
stays there until its own `reload()`.

```ts
// Retry a failed first load every 30 seconds until the backend is back.
useEffect(() => {
  if (!isLoadingError) return
  const id = setInterval(() => collection.reload().catch(() => {}), 30_000)
  return () => clearInterval(id)
}, [isLoadingError, collection])
```

Calling `reload()` while a reload is in flight returns the same promise. On a
`crashed` Collection it rejects with `CollectionReloadCrashedError`.

Use `reload()` for retries the user or the app decides on. Retries inside one
attempt belong to the sync adapter: for example, set `retry` on a Query
Collection, so a short outage never reaches `isLoadingError`.

### When a Collection crashes

A Collection crashes when its local storage can no longer serve reads or
accept writes:

- its IndexedDB connection closed (for example after a `versionchange` from
  another tab);
- a local SQLite persistence write or restore failed;
- its sync function threw, or an internal invariant failed.

The Collection moves to `crashed`, and so does every live query and Effect over
it, even after they were ready. A crash is permanent for that Collection
instance: `reload()` rejects. To recover, clean up the Collection together with
everything that reads from it, then create a new one.

```ts
console.log(todos.subscribers) // live queries, Effects, and raw subscriptions
await todos.cleanup({ dependents: true })
const freshTodos = createCollection(todosOptions())
```

### Cleaning up a Collection

`cleanup()` rejects with `CollectionHasSubscribersError` while a live query
with subscribers or an Effect still reads the Collection, because those readers
would lose their data. Unmount the components that read it first, or pass
`{ dependents: true }` to end its live queries and Effects first. Raw
`subscribeChanges()` subscriptions do not block cleanup and are not ended by
it. `collection.subscribers` lists every dependent with its `kind`. Collections
that nothing reads are cleaned up automatically after `gcTime`.

### Persisted Collections

A persisted Collection restores its rows from local storage before the remote
syncs. By default it becomes `ready` only through its sync adapter. With
`initialRender: { strategy: "network-first", networkTimeoutMs }`, restored rows
make it `ready` once the deadline passes or the remote fails its first load. An
empty restore keeps it `loading`, and a failed restore crashes it. See
[Render after SQLite restore](./sqlite-persistence.md#render-after-sqlite-restore).

### Effects

An Effect ends when a source it reads fails its first load or crashes, or when
a load it needs fails; it calls `onSourceError(error)`. After its initial
load, a sync problem on a source calls `onErrorsChange(errors)` with the same
tree a live query returns, and the Effect keeps running.

```ts
createEffect({
  query: (q) => q.from({ order: orders }),
  onBatch: (events) => {
    /* ... */
  },
  onErrorsChange: (errors) => {
    if (errors.hasErrors) pauseAutomations()
    else resumeAutomations()
  },
})
```

### Using Suspense and Error Boundaries (React)

`useLiveSuspenseQuery` suspends while `loading` and throws the first load's
cause to the nearest error boundary for `error`. It throws for `crashed` at any
time. Sync problems after the first data never reach the boundary; read
`errors` from the hook, as in TanStack Query.

```tsx
import { useLiveSuspenseQuery } from "@tanstack/react-db"
import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

const TodoList = () => {
  const { data, isSyncError } = useLiveSuspenseQuery((query) =>
    query.from({ todos: todoCollection })
  )

  // data is always defined here
  return (
    <>
      {isSyncError && <div>Todos may be out of date.</div>}
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

See the [React Suspense section in Live Queries](./live-queries#using-with-react-suspense) for more details.

### For sync adapter authors

A sync adapter reports failures with three calls:

| Call | Meaning | Effect |
| --- | --- | --- |
| `reportError(error)` | Something went wrong; I am still trying. | Sets `failureReason`. Only after the first ready. |
| `fail(error)` | I stopped. | Before the first ready: `status: 'error'`. After: the node's `error`; the rows stay. |
| `reportHealthy()` | Sync works again. | Clears `failureReason`. Only after the first ready. |

```ts
sync: ({ begin, write, commit, markReady, reportError, fail, reportHealthy }) => {
  let ready = false
  const stream = connect({
    onData: (rows) => {
      begin()
      rows.forEach((row) => write({ type: "insert", value: row }))
      commit()
      if (ready) reportHealthy()
      else markReady()
      ready = true
    },
    onError: (error, { willRetry }) => {
      if (!willRetry) fail(error)
      else if (ready) reportError(error)
    },
  })
  return () => stream.close()
}
```

- Retry inside the first load before calling `fail`. While you retry before
  the first ready, call nothing; the Collection stays `loading`.
- These calls follow the Collection's state machine, and a call that does not
  fit it throws: `reportError` or `reportHealthy` before the first ready,
  `markReady` after a failed first load, and any call after `fail`. Calls
  after a crash do nothing. `reportHealthy` when nothing is wrong changes
  nothing, so you can call it after every commit.
- An `error` from `fail` clears only through `reload()`, which calls your
  `sync` function again for a new run.
- Keep the run's readiness in your `sync` function, as `ready` above does.
  Do not read `collection.status` to learn whether this run is ready: during
  a reload it still shows the previous run's status.

### Migrating

| Before | After |
| --- | --- |
| `isError` | `isLoadingError` (first load failed) or `isCrashed` (storage broke) |
| `status: 'error'` after a crash | `status: 'crashed'` |
| `markError(error)` | `fail(error)` |
| `reportError(error, { final })` | `reportError(error)` or `fail(error)` |
| node `phase`, `final`, `isError` | node `failureReason` or `error` |
| node `instances` | removed |
| `cleanup()` then `preload()` to recover | `reload()` |
| `cleanup()` with live queries mounted | rejects; unmount first or `cleanup({ dependents: true })` |
| `persistedStatus`, `isPersistedReady`, `persistedError`, `preloadForInitialRender()` | `status` and `errors` |
| query-db `utils.lastError`, `isError`, `errorCount`, `clearError()` | `errors`, `reload()` |
| `collection.health`, `health:change` | `collection.errors`, `errors:change` |
| Effect `onHealthChange` | `onErrorsChange` |

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
- A failure before the first successful result fails the first load: the status is `error`, and readiness waits such as `preload()` and `toArrayWhenReady()` reject with the cause
- A later refetch failure keeps the Collection `ready` with its cached data and sets the source node's `failureReason`, because TanStack Query fetches again
- A later successful refetch clears the `failureReason`
- To retry a failed first load, call `collection.reload()`

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

### Reload or Recreate

To retry a failed first load or a stopped sync, call `reload()` on the
Collection or on the live query that reads it. See [Reloading](#reloading). A
crashed Collection cannot reload; clean it up with `{ dependents: true }` and
create a new one. See [When a Collection crashes](#when-a-collection-crashes).

### Graceful Degradation

After the first ready, Collections keep working with their rows when sync
fails. The error tree tells you which source has the problem and whether its
sync adapter is still trying:

```tsx
import { findProblems } from "@tanstack/db"

const TodoApp = () => {
  const { data, errors, collection } = useLiveQuery((query) =>
    query.from({ todos: todoCollection })
  )
  const [problem] = errors ? findProblems(errors) : []

  return (
    <div>
      {problem?.error && (
        <div>
          Sync stopped.{" "}
          <button onClick={() => collection.reload()}>Reload</button>
        </div>
      )}
      {problem?.failureReason && <div>Reconnecting. Showing saved data.</div>}
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
4. **Check both questions** - Use `status` (`isLoading`, `isLoadingError`, `isCrashed`) for whether data can be shown, and `isSyncError` or `errors` for whether it may be stale
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
  const { data, isLoadingError, isCrashed, isLoading, isSyncError } =
    useLiveQuery(todosQuery)

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

  const handleReload = async () => {
    try {
      await todosQuery.reload()
    } catch (error) {
      alert(`Failed to reload todos: ${String(error)}`)
    }
  }

  if (isCrashed) {
    return <div>Local storage failed. Reload the page.</div>
  }

  if (isLoadingError) {
    return (
      <div>
        <div>Todos could not load</div>
        <button onClick={handleReload}>Try again</button>
      </div>
    )
  }

  if (isLoading) {
    return <div>Loading todos...</div>
  }

  return (
    <div>
      {isSyncError && <div>Todos may be out of date</div>}
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
