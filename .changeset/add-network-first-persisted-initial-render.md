---
'@tanstack/db': minor
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/angular-db': minor
'@tanstack/react-db': minor
'@tanstack/solid-db': minor
'@tanstack/svelte-db': minor
'@tanstack/vue-db': minor
---

Add opt-in network-first initial rendering for eagerly persisted SQLite Collections. `initialRender: { strategy: 'network-first', networkTimeoutMs }` lets React and Solid Suspense render restored rows after the configured deadline (three seconds by default) or a network failure while sync continues. Live-query observers and the Angular, React, Solid, Svelte, and Vue integrations expose `persistedStatus`, `isPersistedReady`, and `persistedError` separately from Collection readiness.
