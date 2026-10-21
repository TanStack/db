---
'@tanstack/db': minor
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/electric-db-collection': minor
'@tanstack/powersync-db-collection': minor
'@tanstack/query-db-collection': minor
'@tanstack/rxdb-db-collection': minor
'@tanstack/trailbase-db-collection': minor
'@tanstack/react-db': minor
'@tanstack/vue-db': minor
'@tanstack/solid-db': minor
'@tanstack/svelte-db': minor
'@tanstack/angular-db': minor
---

Collections now answer two questions separately: can the data be shown (`status`), and is it still kept up to date (`errors`). Once a query has shown data, a network or backend failure never takes it off the screen.

- `status` gains `crashed`: local storage broke (a closed IndexedDB connection, a failed SQLite persistence write or restore, a throwing sync function, or an invariant failure). It is permanent for the instance and reaches every live query and Effect above it. `error` now means only "the first load failed".
- Every Collection has `collection.errors`, an error tree node with `status`, `failureReason` (the adapter is still trying), `error` (the adapter stopped, or the first load failed), `reloading`, and `hasErrors`. A live query's `errors` has one node per source alias, in query order, and keeps object identity while unchanged. `errors:change` fires when it changes. `findProblems(errors)` lists the nodes that have a problem, in query order.
- `collection.reload()` starts a new sync run and keeps the rows, status, and error on screen until the new run commits. On a live query it reloads every Collection below it that shows an `error`, through nested live queries, then the query itself. It rejects on a `crashed` Collection, and an adapter cleanup that rejects during a reload crashes the Collection. A query in `error` restarts by itself only when the source whose failed first load caused it becomes ready.
- `cleanup()` rejects with `CollectionHasSubscribersError` while a live query with subscribers or an Effect reads the Collection. `cleanup({ dependents: true })` ends them first. `collection.subscribers` lists every dependent.
- Persisted Collections have one status. With `initialRender: { strategy: 'network-first' }`, restored rows make the Collection `ready` once the deadline passes or the remote fails; an empty restore stays `loading`.

Breaking changes and migration:

| Before                                                                                                      | After                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| hook `isError`                                                                                              | `isLoadingError` (first load failed) or `isCrashed`                                              |
| —                                                                                                           | `isSyncError`: `ready` and the error tree has a problem                                          |
| `status: 'error'` after a crash                                                                             | `status: 'crashed'`                                                                              |
| adapter `markError(error)`                                                                                  | `fail(error)`. After readiness it sets the node's `error` and keeps the rows. Later calls throw. |
| `reportError(error, { final })`                                                                             | `reportError(error)` (sets `failureReason`, after readiness only) or `fail(error)`               |
| `cleanup()` then `preload()` to recover                                                                     | `reload()`                                                                                       |
| `cleanup()` while live queries or Effects read the Collection                                               | rejects; unmount first or pass `{ dependents: true }`                                            |
| `collection.health`, `health:change`                                                                        | `collection.errors`, `errors:change`                                                             |
| node `phase`, `final`, `isError`, `instances.inError`                                                       | node `failureReason` or `error`, `instances.withErrors`                                          |
| Effect `onHealthChange`                                                                                     | `onErrorsChange`                                                                                 |
| `persistedStatus`, `isPersistedReady`, `persistedError`, `preloadForInitialRender()`, `PERSISTED_READINESS` | `status` and `errors`                                                                            |
| query-db `utils.lastError`, `utils.isError`, `utils.errorCount`, `utils.clearError()`                       | `collection.errors`, `reload()`                                                                  |
| infinite-query hooks' `error` (React, Vue, Svelte)                                                          | the root node's `error` in `errors`; `fetchNextPage()` still resolves                            |

Custom sync adapters: keep the run's readiness in your `sync` function. A reload calls `sync` again while `collection.status` still shows the previous run's status, and a reload replaces every row at the new run's first commit, so write a full snapshot then. `reportError()` and `reportHealthy()` throw before the first `markReady()`. `markReady()` after a failed first load throws. Calls after a crash do nothing. `useLiveSuspenseQuery` now throws the first load's original cause instead of a generic error.
