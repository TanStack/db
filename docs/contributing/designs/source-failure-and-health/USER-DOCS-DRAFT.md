# Draft: what users would see (candidate v2)

This is a superseded proposal, not shipped behavior. It applies the repairs
from the hostile assay and the fracture scan to `HEALTH-CANDIDATE.md`. The
shipped API differs (for example, `reportError` has no `final` option, and
query-db's error utilities are removed); read `PLAN.md` and the shipped
guides.

---

## Guide: errors, readiness, and stale data

A Collection answers two separate questions:

| Question | Where to look | Changes when |
| --- | --- | --- |
| Can I show this data yet? | `status`, `isReady`, `isError` | Only during the initial load of a sync run |
| Is this data still being kept up to date? | `errors` (the error tree) | Any time a source reports a problem or recovers |

### The initial load

Until a Collection has its first usable snapshot, `status` is `loading`. If the
source keeps retrying, it stays `loading`. If the sync adapter gives up, `status`
becomes `error`, `isError` is `true`, `preload()` rejects with the original
cause, and every live query that depends on it is in error too.

An initial error is final. TanStack DB does not retry it or recover from it on
its own. To try again, restart the query:

```ts
await todosQuery.cleanup()
await todosQuery.preload()
```

### After the first ready

Once the data has loaded, it stays. If the source later loses its connection or
a refresh fails, `status` stays `ready` and your rows stay on screen, even as
they get older. The problem appears in `errors` instead.

> **Important:** `isError` only describes the initial load. To show a
> "data may be out of date" banner, check `errors.hasErrors`.

```tsx
function TaskList() {
  const { data, isLoading, isError, errors } = useLiveQuery((q) =>
    q
      .from({ task: tasks })
      .join({ user: users }, ({ task, user }) => eq(task.assigneeId, user.id)),
  )

  if (isLoading) return <Spinner />
  if (isError) return <LoadFailed error={errors.error ?? errors.sources[0]?.error} />

  return (
    <>
      {errors.hasErrors && <StaleBanner errors={errors} />}
      {data.map((row) => (
        <TaskRow key={row.task.id} {...row} />
      ))}
    </>
  )
}
```

### The error tree

Every live query result includes `errors`. It always has the same shape for a
given query: one node for the live query, and one node for each source in the
query, in query order. Healthy nodes are present too, with `isError: false`.

```ts
type ErrorTreeNode = {
  alias: string                 // the query alias, or "root"
  collectionId: string
  kind: 'source' | 'live-query' | 'include'
  status: CollectionStatus      // the node's initial-load gate
  isError: boolean              // this node has a problem now
  hasErrors: boolean            // this node or any node below it
  error: CollectionErrorInfo | null
  instances?: { total: number; inError: number } // include nodes only
  sources: Array<ErrorTreeNode>
}

type CollectionErrorInfo = {
  phase: 'initial' | 'sync' | 'request'
  final: boolean   // the source has stopped trying; only a restart clears it
  name: string
  message: string
  code?: string
  at: number       // epoch milliseconds
  cause: unknown   // the original value; omitted from JSON
}
```

For the query above, while the users sync is disconnected:

```json
{
  "alias": "root",
  "collectionId": "live-query-1",
  "kind": "live-query",
  "status": "ready",
  "isError": false,
  "hasErrors": true,
  "error": null,
  "sources": [
    {
      "alias": "task",
      "collectionId": "tasks",
      "kind": "source",
      "status": "ready",
      "isError": false,
      "hasErrors": false,
      "error": null,
      "sources": []
    },
    {
      "alias": "user",
      "collectionId": "users",
      "kind": "source",
      "status": "ready",
      "isError": true,
      "hasErrors": true,
      "error": {
        "phase": "sync",
        "final": false,
        "name": "FetchError",
        "message": "Network request failed",
        "at": 1760342400000
      },
      "sources": []
    }
  ]
}
```

Phases:

- `initial`: the source gave up before Collection readiness. `status` is `error`.
- `sync`: the source reported a problem after ready. `final: false` means it
  is still trying; `final: true` means it stopped, and only a restart clears it.
- `request`: loading data for this query failed while its source stayed
  healthy. It clears when that data loads, or when the query stops needing it.

A collection used twice in one query, for example a self-join, appears once per
alias. An include has one node for all of its per-row child collections, with
`instances` counting how many are in error.

`errors` is plain data apart from `cause`, so you can log or send it:

```ts
useEffect(() => {
  if (errors.hasErrors) reportToMonitoring(JSON.parse(JSON.stringify(errors)))
}, [errors])
```

Server-side rendering does not transfer `errors`. The client builds its own
tree from its own sync.

### Effects

An Effect is disposed by an initial-load error, as today. After its first
ready, a source problem does not dispose it. Subscribe to health instead:

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

---

## Guide for adapter authors

Your sync function receives two new callbacks:

```ts
sync: ({ begin, write, commit, markReady, markError, reportError, reportHealthy }) => {
  const stream = connect({
    onData: (rows) => {
      begin()
      rows.forEach((row) => write({ type: 'upsert', value: row }))
      commit()
      if (!readyOnce) {
        markReady()
        readyOnce = true
      } else {
        reportHealthy() // a successful sync after a problem
      }
    },
    onError: (error, { willRetry }) => {
      if (!readyOnce) {
        // Keep trying silently. Report only when you give up.
        if (!willRetry) markError(error)
      } else {
        // The data is already showing. Report the problem; keep the rows.
        reportError(error, { final: !willRetry })
      }
    },
  })
  return () => stream.close()
}
```

The rules:

1. While you are still retrying the initial load, call nothing. The
   Collection stays `loading`.
2. Call `markError(error)` only when you give up before Collection readiness. Do
   not call `markReady()` after that; restart is the app's job.
3. After the first ready, call `reportError(error, { final })` for problems
   and `reportHealthy()` when sync works again. Never move a ready Collection
   to `error`.
4. Do not discard rows because sync failed.

`markError(error)` after Collection readiness still works during migration. It is
treated as `reportError(error, { final: true })` and logs a development
warning.

### Migration notes for the built-in adapters

- **Electric:** a stream error that `onError` retries is not reported. When the
  stream gives up after Collection readiness, it reports `final: true` instead of
  moving the Collection to `error`.
- **PowerSync:** a failed tracking rebuild reports `reportError`; a successful
  rebuild reports `reportHealthy()` instead of `markReady()`.
- **query-db:** a failed refetch after ready reports `reportError`;
  `utils.lastError`, `utils.isError`, and `utils.errorCount` keep working. A
  successful refetch no longer revives a Collection whose initial load failed;
  call `cleanup()` and `preload()` instead.
- **TrailBase, RxDB, persistence:** post-ready failures move to
  `reportError`. Persistence keeps local storage failures on `persistedError`.

---

## Open questions this draft does not settle

- Ordering: `health:change` fires in the same tick, after `status:change`
  when both change. This is proposed, not checked.
- Follower tabs: how a follower learns that the leader's upstream failed.
- Pooled live queries that share sources.
- Whether `errors` should be a new object on every change or keep stable
  node identities for memoization.
