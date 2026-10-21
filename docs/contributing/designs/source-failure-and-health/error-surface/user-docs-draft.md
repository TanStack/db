---
title: Error Handling
id: error-handling
---

<!--
DRAFT (2026-10-16) of the loading and sync sections of docs/guides/error-handling.md under
design grammar v4. It replaces "Query Collection Error Tracking", "Incremental Subset Load
Errors", "Collection Status and Error States", and "Collection Cleanup and Restart". The
mutation, transaction, and error-class sections stay as they are.
Decisions applied: tree helper, query-level reload, `collection.errors` on every
Collection, `subscribers` and `cleanup({ dependents: true })`, adapter calls that throw
outside the state machine, and no remaining "health" names.
-->

## Loading and sync errors

An app that shows synced data asks two questions:

1. **Can I show the data?** Read `status`.
2. **Is the data on screen still being kept up to date?** Read `isSyncError` and `errors`.

TanStack DB answers them separately. Once a query has shown data, a network or backend
failure never takes the data off the screen. It shows up in `errors`, and the rows stay.

```tsx
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
      .join({ user: users }, ({ task, user }) => eq(task.assigneeId, user.id)),
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

| `status`     | Flag             | Meaning                                                    | What the app does                                                                      |
| ------------ | ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `idle`       | `isIdle`         | Sync has not started.                                      | Nothing yet.                                                                           |
| `loading`    | `isLoading`      | The first data is on its way.                              | Show a placeholder.                                                                    |
| `ready`      | `isReady`        | The data can be shown.                                     | Show it. Check `isSyncError` for a banner.                                             |
| `error`      | `isLoadingError` | The first load failed. There is nothing to show.           | Show a failure screen and offer `reload()`.                                            |
| `crashed`    | `isCrashed`      | Local storage broke. This Collection cannot be used again. | Recreate the Collection (see [When a Collection crashes](#when-a-collection-crashes)). |
| `cleaned-up` | `isCleanedUp`    | The Collection was cleaned up.                             | Nothing.                                                                               |

Two rules make `status` predictable:

- **After a query has shown data, only a crash changes its status.** A dropped connection,
  a failed refetch, or a backend that stops answering appears in `errors`. `isLoadingError`
  therefore always means "nothing to show yet".
- **A query takes the worst status of its sources until it is ready.** If any source fails
  its first load, the query's status is `error`.

`isError` is deprecated. It is `true` for `error` and `crashed`. Use `isLoadingError` and
`isCrashed`, which need different handling.

### Sync errors: the `errors` tree

`errors` has one node for the query itself and one for each source in the query, in query
order. The tree's shape is fixed by the query, so you can render, log, or send it to
monitoring.

```ts
{
  alias: 'root', kind: 'live-query', status: 'ready', hasErrors: true,
  failureReason: null, error: null, reloading: false,
  sources: [
    { alias: 'task', kind: 'source', status: 'ready', hasErrors: false,
      failureReason: null, error: null, reloading: false, sources: [] },
    { alias: 'user', kind: 'source', status: 'ready', hasErrors: true,
      failureReason: { name: 'FetchError', message: 'Network request failed', at: 1760342400000 },
      error: null, reloading: false, sources: [] },
  ],
}
```

A node can show one of two problems. They follow TanStack Query's `failureReason` and
`error`:

| Field           | Meaning                                                                                                | What the app does                            |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `failureReason` | Something went wrong, and the sync adapter is still trying. It clears by itself when sync works again. | Show "Reconnecting…" or nothing. Wait.       |
| `error`         | The sync adapter stopped. The rows from this source stay but no longer update.                         | Show "Updates stopped" and offer `reload()`. |

`isSyncError` is `true` when the query is `ready` and any node has a `failureReason` or an
`error`. `hasErrors` on a node says whether that node or any node below it has one.

Each problem is `{ name, message, code?, at, cause }`. `cause` holds the exact value the
adapter reported, for example the `Response` or the error your `queryFn` threw. Every other
field is plain JSON. A node keeps its object identity until something in its part of the
tree changes, so `===` and `useMemo` work on it.

`failureReason` says that the adapter is trying, not that trying will help. An expired
token gives a `failureReason` on every refetch until the user signs in. Use `code` or
`cause` for cases like this:

```ts
function SyncBanner({ errors, onReload }: { errors: ErrorTreeNode; onReload: () => void }) {
  const [first] = findProblems(errors) // nodes with a problem, in query order
  if (first?.failureReason?.code === '401') return <SignInAgain />
  if (first?.error) return <UpdatesStopped onReload={onReload} />
  return <Reconnecting />
}
```

`findProblems(errors)` walks the tree and returns every node with a `failureReason` or an
`error`, in query order, each with its `alias` path. Use it for the message on a failure
screen too: when `isLoadingError` is true, `findProblems(errors)[0].error` is the first
load failure that stopped the query.

`onReload` here calls the query's `reload()`, which reloads every source that has an
`error`. To reload one source instead, call `reload()` on that source's Collection.

### Collections without a live query

Every Collection has the same surface, so code that uses a Collection directly does not
need a live query:

```ts
todos.status // 'loading' | 'ready' | 'error' | 'crashed' | ...
todos.errors // one node: { status, failureReason, error, reloading, ... }
todos.on('errors:change', ({ errors }) => report(errors))
await todos.reload()
```

A live query is a Collection too; its `errors` is the whole tree.

### Failed requests for more data

After a query is ready it can ask for more data: the next page of an infinite query, or
rows for a newly joined key. When that request fails, the query's own node (`root`) shows
an `error`. The sources stay healthy and the rows already shown stay. The error clears when
the data loads, or when the query no longer needs it, for example after the user scrolls
back.

```tsx
const { data, errors, fetchNextPage } = useLiveInfiniteQuery(/* ... */)

{
  errors?.error && (
    <button onClick={() => fetchNextPage()}>Retry loading more</button>
  )
}
```

`fetchNextPage()` resolves either way. A reload of a source re-issues failed requests for
that source.

### Reloading

`collection.reload()` starts a new sync run for a Collection. It works like a sync-side
truncate: nothing visible changes until the new run's first commit.

- The current rows, `status`, and any `error` stay on screen. The node shows
  `reloading: true`.
- When the new run commits, its rows replace the old rows in one change, and the node's
  problem clears. A `status` of `error` becomes `ready`.
- If the new run fails before it commits, the old rows and status stay, and the node shows
  the new `error`.

On a live query, `reload()` reloads each of its sources that has an `error`.

```ts
// Retry a failed first load every 30 seconds until the backend is back.
useEffect(() => {
  if (!isLoadingError) return
  const id = setInterval(() => collection.reload(), 30_000)
  return () => clearInterval(id)
}, [isLoadingError, collection])
```

`reload()` returns a promise that settles when the new run commits or fails. Calling it
while a reload is in flight returns the same promise. On a `crashed` Collection it throws.

Use `reload()` for retries the user or the app decides on. Retries inside one attempt belong
to the sync adapter: for example, set `retry` on a Query Collection, so a short outage never
reaches `isLoadingError`.

While a query waits on a source's reload, its status stays `error`. Once no source has an
error, a query that is still waiting for another source's first load shows `loading`.

### When a Collection crashes

A Collection crashes when its local storage can no longer serve reads or accept writes:

- its IndexedDB connection closed (for example after a `versionchange` from another tab);
- a local SQLite persistence write or restore failed;
- an internal invariant failed.

The Collection moves to `crashed`, and so does every live query over it. A crash is
not recovered in place: `reload()` throws. To recover, clean up the Collection together
with everything that reads from it, then start it again.

```ts
console.log(todos.subscribers) // live queries, Effects, and raw subscriptions
await todos.cleanup({ dependents: true })
const freshTodos = createCollection(todosOptions())
```

### Cleaning up a Collection

`cleanup()` throws while anything still subscribes to the Collection, because those
readers would lose their data. Unmount the components that read it first, or pass
`{ dependents: true }` to clean up its live queries and Effects first.
Collections that nothing reads are cleaned up automatically after `gcTime`.

### Persisted Collections

A persisted Collection restores its rows from local storage before the remote syncs.

- **Restored rows open the Collection.** If local storage holds rows from an earlier sync,
  the Collection becomes `ready` with them, even if the remote has not connected yet. Remote
  problems after that appear in `errors` like any other sync problem.
- **A failed remote waits for the restore.** If the remote fails before the restore
  finishes, the Collection waits: restored rows make it `ready` with an `error` on its node;
  no stored rows make it `error`.
- **An empty local store does not open the Collection.** A Collection that has never synced
  stays `loading` until the remote answers, so an empty list always means "no rows", not
  "unknown".
- **A failed restore is a crash.**

`persistedStatus`, `isPersistedReady`, and `persistedError` are removed.

### Effects

An Effect ends when a source it reads fails its first load or crashes; it calls
`onSourceError(error)`. After its initial load, any other problem calls
`onErrorsChange(errors)` with the same tree a live query returns, and the Effect keeps
running.

### Suspense and error boundaries (React)

`useLiveSuspenseQuery` suspends while `loading` and throws to the nearest error boundary for
`error` and `crashed`. Sync problems after the first data never reach the boundary; read
`errors` from the hook.

## For adapter authors

A sync adapter reports failures with three calls:

| Call                 | Meaning                                  | Effect                                                                               |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `reportError(error)` | Something went wrong; I am still trying. | Sets `failureReason` (after the first ready).                                        |
| `fail(error)`        | I stopped.                               | Before the first ready: `status: 'error'`. After: the node's `error`; the rows stay. |
| `reportHealthy()`    | Sync works again.                        | Clears `failureReason`.                                                              |

```ts
sync: ({
  begin,
  write,
  commit,
  markReady,
  reportError,
  fail,
  reportHealthy,
}) => {
  let ready = false
  const stream = connect({
    onData: (rows) => {
      begin()
      rows.forEach((row) => write({ type: 'insert', value: row }))
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

- Retry inside the first load before calling `fail`. While you retry before the first
  ready, call nothing; the Collection stays `loading`.
- These calls follow the Collection's state machine, and a call that does not fit it
  throws: `reportError` or `reportHealthy` before the first ready, `markReady` after
  `fail`, and any call after the sync run has ended. `reportHealthy` when nothing is wrong
  is allowed and changes nothing, so you can call it after every commit.
- An `error` from `fail` clears only through `reload()`, which calls your `sync` function
  again for a new run.

## Migrating

| Before                                                              | After                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `isError`                                                           | `isLoadingError` (first load failed) or `isCrashed` (storage broke) |
| `status: 'error'` after a crash                                     | `status: 'crashed'`                                                 |
| `markError(error)`                                                  | `fail(error)`                                                       |
| `reportError(error, { final })`                                     | `reportError(error)` or `fail(error)`                               |
| node `phase`, `final`, `isError`                                    | node `failureReason` or `error`                                     |
| `cleanup()` then `preload()` to recover                             | `reload()`                                                          |
| `cleanup()` with live queries mounted                               | throws; unmount first or `cleanup({ dependents: true })`            |
| `persistedStatus`, `isPersistedReady`, `persistedError`             | `status` and `errors`                                               |
| query-db `utils.lastError`, `isError`, `errorCount`, `clearError()` | `errors`, `reload()`                                                |
| `collection.health`, `health:change`                                | `collection.errors`, `errors:change`                                |
| Effect `onHealthChange`                                             | `onErrorsChange`                                                    |
