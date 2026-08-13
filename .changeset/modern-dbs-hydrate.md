---
'@tanstack/db': minor
'@tanstack/react-db': minor
'@tanstack/react-router-with-db': minor
'@tanstack/electric-db-collection': minor
'@tanstack/query-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/trailbase-db-collection': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Add collection-row SSR through request-scoped `DbClient` instances, collection
descriptors, holistic and incremental hydration, adapter sync metadata, and
React descriptor resolution.

React live queries now derive identity from structured query IR. Opaque queries
can provide `queryKey`; legacy dependency arrays and unkeyed opaque queries keep
working with development warnings until 1.0.

Add TanStack Router integration that streams live queries discovered during a
Suspense render as pending promises which resolve to normalized collection rows.
