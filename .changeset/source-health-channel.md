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

- An initial error is final for its sync run. A later successful sync no longer moves a Collection from `error` back to `ready`. Restart instead: `await collection.cleanup()` then `await collection.preload()`. For query-db, a successful refetch or `utils.clearError()` after an initial failure clears `utils.lastError` but leaves the status `error` until a restart.
- After a Collection is ready, sync failures no longer set `status` to `error` or `isError` to `true`. To show a "data may be out of date" message, read `errors.hasErrors` from the hook, or `collection.health`.
- A Collection that can no longer serve reads or accept writes crashes: a closed IndexedDB connection or a failed local SQLite persistence write moves it to `error` even after it was ready. Every live query and Effect over a Collection in `error` now fails too, whether the cause is an initial error or a crash.
- Adapter authors: call `markError(error)` only when you give up before the first `markReady()`. After it, call `reportError(error, { final })` for problems and `reportHealthy()` when sync works again. `markReady()` after `markError()` in the same sync run now throws. `markError()` after the first `markReady()` is treated as `reportError(error, { final: true })` and logs a development warning.
- Electric reports nothing while its stream retries, and reports a final health error when it gives up after readiness. TrailBase reports a final health error when its change stream ends, because it does not resubscribe. PowerSync reports a failed tracking rebuild as a health error that clears after a successful rebuild. query-db mirrors `utils.lastError` into Collection health after readiness.
