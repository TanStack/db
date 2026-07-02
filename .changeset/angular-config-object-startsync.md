---
'@tanstack/angular-db': patch
---

fix(angular-db): a `{ query }` config-object passed to `injectLiveQuery` now syncs

The config-object branch called `createLiveQueryCollection(opts)` without defaulting `startSync`, unlike the query-function and reactive-options branches (which force `startSync: true`), so a bare `{ query }` never started syncing and produced no data. It now defaults `startSync: true` and `gcTime: 0` while still honoring any explicit values in the config.
