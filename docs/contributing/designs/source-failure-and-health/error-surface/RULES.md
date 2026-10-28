# Frozen grammar v4: app-facing error model for a reactive local-first data library

A *Collection* holds rows kept in sync with a backend by a *sync adapter*. A *live query*
reads one or more Collections ("sources", one per query alias) and is itself a Collection.
Apps read a live query through framework hooks. Some Collections are *persisted*: they
restore rows from local disk storage and also sync with a remote backend.

## Surface
- `status`: 'idle' | 'loading' | 'ready' | 'error' | 'crashed' | 'cleaned-up'
- One boolean per status: isIdle, isLoading, isReady, isLoadingError (status 'error'),
  isCrashed, isCleanedUp. `isError` is deprecated.
- `isSyncError`: status is 'ready' and the tree holds any `failureReason` or `error`.
- `health`: a tree, one node per query alias plus a root node for the query. Each node:
  { alias, kind: 'source'|'live-query'|'include', status, hasErrors, error | null, sources }.
  A source node carries at most one of:
  - `failureReason`: the latest problem while the adapter keeps trying (like TanStack Query's
    `failureReason` during retries);
  - `error`: the adapter stopped (`fail`), or the gate failed.
  Each value is { name, message, code?, at, cause }. A node also shows `reloading` while a
  reload's new run is in flight. The query's own node carries a request `error`.
- `collection.health`: the Collection's current after-ready error, or null.
- `collection.reload()`: start a new sync run while keeping the current rows (see R7).
- `collection.cleanup()`: throws while the Collection has subscribers. The app can list a
  Collection's subscribers (live queries, Effects, raw subscriptions) and ask cleanup to clean
  up those dependents first.

## Rules
R1 Gate. Each sync run: loading -> ready | error | crashed. An adapter that keeps retrying
   before its first ready reports nothing (status stays loading). 'error' (gave up before the
   first ready) is final for the run.
R2 Crash. 'crashed' = the Collection can no longer serve reads or accept writes: local
   storage broken (closed IndexedDB, a failed local write or restore) or an internal invariant
   failure. Final for the run; ends every live query and Effect over it. The cause may or may
   not persist into a new run.
R3 Query gate. Until a live query is ready, it takes its sources' worst gate
   (crashed > error > loading > ready). After it is ready, only 'crashed' propagates.
R4 After ready, a failure never changes status or removes rows. It appears on the node that
   owns it:
   - source node, sync problem: `failureReason` (adapter still trying; clears itself) or
     `error` (adapter stopped; rows frozen until reload);
   - a source whose new sync run fails before its first ready while the query is ready
     (an on-demand source loading late, or a source being reloaded): node `error`; the query
     stays ready;
   - query's own node, request error: a request for more data (next page, newly joined rows)
     failed; clears when that data loads or is no longer needed.
R5 Adapter verbs: markReady(); reportError(e) = something went wrong, still running
   (sets `failureReason`); fail(e) = stopped (before ready -> status 'error'; after -> node
   `error`); reportHealthy() clears `failureReason`. A node `error` clears only when a
   reload's new run commits.
R6 Tree identity is stable while content is unchanged; every field except `cause` is JSON.
R7 Reload. reload() starts a new sync run like a sync-side truncate. Nothing visible changes
   until the new run's first commit or failure: rows, status ('ready' or 'error'), and the
   current error stay, and the node shows `reloading`. The first commit replaces all rows
   atomically and clears the node's problem (an 'error' status becomes 'ready'). If the new
   run fails first, the old rows and status stay and the node shows the new `error`.
   reload() while a reload is in flight returns that reload's promise. reload() on a
   'crashed' Collection throws: a crash is not recovered in place; recovery is a cascade
   cleanup, which discards all state, and a fresh start (of the same object or a new one). reload() during 'loading' starts a new run; commits from the old run are
   ignored. A failed request is re-issued by the new run.
R9 Live-query reload. reload() on a live query in 'error' reloads each of its sources in
   'error' or with a node `error`. Its status stays 'error' while any source still has a
   failure, including a source whose reload is in flight (it keeps its 'error' gate). Once no
   source has a failure, the query moves to 'loading', or straight to 'ready'. Adapters retry inside their
   first load (for example query-db's retry or the queryFn) before calling fail().
R8 Persisted Collections. A completed local restore of previously synced rows opens the gate
   (status 'ready') even if the remote has not connected; remote problems after that are
   reported (R4/R5), including before the remote's first sync. A remote that fails before the
   restore finishes waits for the restore: synced rows -> 'ready' with node `error`; none ->
   'error'. A failed restore is a crash. An empty restore of a Collection that never synced
   does not open the gate.

## Invariants
I1 isLoadingError is never true after the query has shown data in its run.
I2 After a query is ready, its status is 'ready' or 'crashed' until it is recreated.
I3 Status 'ready' implies rows are shown; no after-ready failure or reload blanks rows.
I4 From what the app can observe, it can pick one remedy: wait, retry the action, reload,
   report broken storage.
I5 No silent recovery or silent degradation: 'error' becomes 'ready' only through a reload's
   commit; 'crashed' never becomes 'ready' without a cleanup in between; a failing remote is never
   shown as healthy; a reload never shows 'loading' in place of 'error'.
I6 'crashed' always means broken local storage or an invariant failure.
I7 Rows shown never come from a superseded run.
I8 'ready' never means "no rows" when the truth is "unknown".
