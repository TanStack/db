# @tanstack/react-router-with-db

## 0.1.0

### Minor Changes

- Add SSR through request-scoped `DbClient` instances, collection descriptors, ([#1564](https://github.com/TanStack/db/pull/1564))
  explicit collection-row hydration, live-query result snapshots, adapter sync
  metadata, and React and Svelte descriptor resolution.

  React live queries now derive identity from structured query IR. Opaque queries
  can provide `queryKey`; legacy dependency arrays and unkeyed opaque queries keep
  working with development warnings until 1.0.

  Add TanStack Router integration that streams live queries discovered during a
  Suspense render as pending promises which resolve to ordered result snapshots.
  The browser starts normal source sync and atomically replaces the snapshot when
  its live result is ready.
