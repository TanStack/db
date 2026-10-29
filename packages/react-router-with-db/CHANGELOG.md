# @tanstack/react-router-with-db

## 1.0.0-rc.1

### Major Changes

- Release the first 1.0 candidate. Remove deprecated pre-1.0 APIs and give ([#2171](https://github.com/TanStack/db/pull/2171))
  published row metadata precedence over colliding selected fields. Structured
  source spreads and direct source-row returns keep source attribution; new
  functional objects and other projections receive output Collection metadata.
  Keep the two packages accidentally released as stable 1.x on their stable
  release lines. Both stable minor releases require `@tanstack/db@^1.0.0-rc.0`
  for the RC health and restoration settlement APIs; upgrade DB with them.

  Remove Query Collection’s automatic refetch after mutation handlers. Handlers
  return `Promise<void>` and must await `collection.utils.refetch()` or write
  confirmed data with the `write*` utilities; `{ refetch: false }` is removed.

### Patch Changes

- Start the required Collection sync run when an ordinary subscriber follows an abandoned suspended render. Deferred acquisition still starts no idle source sync run or acquisition attempt. ([#2229](https://github.com/TanStack/db/pull/2229))

  Ordinary subscription admission and deferred acquisition resumption throw during cleanup, including automatic GC. Effects created then return disposed handles. Failed setup releases partial ownership, and throwing callbacks cannot prevent healthy observers receiving cleanup status. Subscribers surviving cleanup retain demand for an explicit restart.

  SSR captures each reader's rows and Collection status. Hydration preserves that view through browser preloads, runtime errors, sibling commits, and delayed streamed records. Missing records reject when transport ends. Known pending results survive normal record-stream close. A new stream after client cleanup starts independently of prior failures.

  Empty loading SSR needs no preload. Rendering rows or readiness requires matching query preparation or explicit source Collection preparation. Streaming Suspense prepares its result. Unsupported preparation throws with guidance. Prepared non-streaming Suspense remains supported. The DbClient query hash includes an infinite query's initial limit and offset.

  Apps without `DbClient` exclude its SSR implementation. Its API stays unchanged.

  Svelte roots initialized with `hydrate()` must set `hydrating` on `DbProvider`. Nested providers inherit it. Each provider clears initial hydration after mount so new children read live rows.

- Updated dependencies [[`43d4ef6`](https://github.com/TanStack/db/commit/43d4ef65cfe5c3cfbce6c56891795cd36a73cc37), [`6c1ca8f`](https://github.com/TanStack/db/commit/6c1ca8f8f9efe437d3cea61b5b9d0a086e2a5e34), [`3920346`](https://github.com/TanStack/db/commit/39203466a73648809fb33161c7319d0c60fbb799), [`5649a07`](https://github.com/TanStack/db/commit/5649a07d468117891193c2e4cde9c7706308b1cd), [`1640de8`](https://github.com/TanStack/db/commit/1640de834bca0588f91432ea80a0f4569157e9dc), [`7d9ed02`](https://github.com/TanStack/db/commit/7d9ed02e085d11e871e4b6424d47e3c0d7073023)]:
  - @tanstack/react-db@1.0.0-rc.1

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
