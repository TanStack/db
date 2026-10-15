---
'@tanstack/db': minor
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/electric-db-collection': minor
'@tanstack/powersync-db-collection': minor
'@tanstack/query-db-collection': minor
'@tanstack/trailbase-db-collection': minor
'@tanstack/react-db': minor
'@tanstack/vue-db': minor
'@tanstack/solid-db': minor
'@tanstack/svelte-db': minor
'@tanstack/angular-db': minor
---

Collections now separate two questions: whether data can be shown, and whether it is still kept up to date.

`status` and `isError` describe the initial load of a sync run. A failure after a Collection is ready no longer moves it to `error`: its rows stay, and the problem appears in the new `collection.health`, the `health:change` event, and the `errors` tree that every live-query hook returns. `errors` has one node per query alias with each node's status and error details, keeps its object identity while unchanged, and is plain data apart from each error's `cause`. Effects receive the same tree through `onHealthChange`.

Breaking changes and migration:

- An initial error is final for its sync run. A later successful sync no longer moves a Collection from `error` back to `ready`. Restart instead: `await collection.cleanup()` then `await collection.preload()`. For query-db, a successful refetch after an initial failure applies its rows but leaves the status `error` until a restart.
- After a Collection is ready, sync failures no longer set `status` to `error` or `isError` to `true`. To show a "data may be out of date" message, read `errors.hasErrors` from the hook, or `collection.health`.
- A Collection that can no longer serve reads or accept writes crashes: a closed IndexedDB connection or a failed local SQLite persistence write moves it to `error` even after it was ready. Every live query and Effect over a Collection in `error` now fails too, whether the cause is an initial error or a crash.
- Adapter authors: call `markError(error)` when you give up. Before the first `markReady()` it fails the sync run; after it, it is a final health error and the rows stay. While you keep trying after readiness, call `reportError(error)`, then `reportHealthy()` when sync works again. `markReady()` after `markError()` in the same sync run now throws.
- Electric reports nothing while its stream retries, and reports a final health error when it gives up after readiness. TrailBase reports a final health error when its change stream ends, because it does not resubscribe. PowerSync reports a failed tracking rebuild as a health error that clears after a successful rebuild. query-db reports a failed refetch or result application after readiness as a health error that clears on the next successful result.
- query-db removes `utils.lastError`, `utils.isError`, `utils.errorCount`, and `utils.clearError()`. Read `collection.health` or a live query's `errors` tree instead, and retry with `utils.refetch({ throwOnError: true })`.
- Infinite-query hooks (`useLiveInfiniteQuery` in React, Vue, and Svelte) remove `error`. A failed page load no longer sets `status` to `error`; it appears as a request error in the returned `errors` tree, and `fetchNextPage()` still resolves.
