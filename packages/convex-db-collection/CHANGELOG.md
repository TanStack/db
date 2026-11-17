# @tanstack/convex-db-collection

## 1.0.0-rc.1.5

### Patch Changes

- Updated dependencies [[`522f657`](https://github.com/TanStack/db/commit/522f65777a42673a1befcb8169854002894d15c0), [`a86aa43`](https://github.com/TanStack/db/commit/a86aa430418572a4834972aa60b7d6a18e2e08ba), [`0e1a1c1`](https://github.com/TanStack/db/commit/0e1a1c116ecd055acefcee85b3862de2cf5c102a), [`6ec538e`](https://github.com/TanStack/db/commit/6ec538ecd3c8a966e6a1e93d88b82023021a47a4)]:
  - @tanstack/db@1.0.0-rc.1.5
  - @tanstack/offline-transactions@1.2.1

## 1.0.0-rc.1.4

### Patch Changes

- Updated dependencies [[`bfb660a`](https://github.com/TanStack/db/commit/bfb660a1e8074064cd1fd93a645273c17aaec98c)]:
  - @tanstack/db@1.0.0-rc.1.4
  - @tanstack/offline-transactions@1.2.0

## 1.0.0-rc.1.3

### Patch Changes

- Updated dependencies [[`8a31870`](https://github.com/TanStack/db/commit/8a318707b2debe080195ae422a63982d118cf72f), [`70a744b`](https://github.com/TanStack/db/commit/70a744b3a4022b6df41b9717108f3e44b999af46)]:
  - @tanstack/db@1.0.0-rc.1.3
  - @tanstack/offline-transactions@1.2.0

## 1.0.0-rc.1.2

### Patch Changes

- Release the Convex query subscription when a Collection's first load fails, or when a later acceptance failure stops the sync run, instead of keeping it until cleanup. A new subscription no longer fails from an error the Convex client cached for its query before it subscribed, such as a restart right after a failed run; it waits for the server's result, also when the server's answer arrives before the client replays the cached error. `awaitSync` during that wait no longer fails the run from the cached error. While the latest result is a failure, `awaitSync` rejects with the reported failure instead of reporting it again. ([#2336](https://github.com/TanStack/db/pull/2336))

- Updated dependencies [[`30e8546`](https://github.com/TanStack/db/commit/30e85464ed2b9b12c5f10981a062427a1fc8daaa), [`a3c4d06`](https://github.com/TanStack/db/commit/a3c4d0676621cc7df4d242bdfe31815509add734), [`035a526`](https://github.com/TanStack/db/commit/035a5260ef994ce3aabed77a3f09b35c71482a9a), [`baabf57`](https://github.com/TanStack/db/commit/baabf57a0f110d57ad9bb7b81148466b18fbe0d1), [`9be51e0`](https://github.com/TanStack/db/commit/9be51e037f6c092bc9625f9b5b4b7e23eb4fa5fe), [`a3c4d06`](https://github.com/TanStack/db/commit/a3c4d0676621cc7df4d242bdfe31815509add734), [`85392bd`](https://github.com/TanStack/db/commit/85392bd1d349aa3bb77c9c11ffba671f0b2d2a84), [`9be3c4e`](https://github.com/TanStack/db/commit/9be3c4ed2c8d9762d3837e38d8869483d50b07f6)]:
  - @tanstack/db@1.0.0-rc.1.2
  - @tanstack/offline-transactions@1.2.0

## 1.0.0-rc.1.1

### Patch Changes

- Updated dependencies [[`bfd1da1`](https://github.com/TanStack/db/commit/bfd1da1a7e752d66fd667adfd3cdf54f60732b22), [`a2f3465`](https://github.com/TanStack/db/commit/a2f346596c34faa7e65211134194337bd2e0007d), [`9cfa11f`](https://github.com/TanStack/db/commit/9cfa11fc712866f8f276e85762865ebb8bd49cbe)]:
  - @tanstack/db@1.0.0-rc.1.1
  - @tanstack/offline-transactions@1.2.0

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

### Minor Changes

- Add a Convex collection adapter with typed query subscriptions, full-row sync, automatic reactive pagination with on-demand windows for a fixed ordered query, durable offline mutation replay, optimistic mutation handlers, and support for both Convex JavaScript and React clients. ([#2230](https://github.com/TanStack/db/pull/2230))

  Add opt-in mutation codecs to the durable outbox while preserving the default wire format and retaining unreadable codec records for recovery.

### Patch Changes

- Updated dependencies [[`db476b8`](https://github.com/TanStack/db/commit/db476b8ed9755e0c0b10b833d187354b4c63585c), [`5649a07`](https://github.com/TanStack/db/commit/5649a07d468117891193c2e4cde9c7706308b1cd), [`43d4ef6`](https://github.com/TanStack/db/commit/43d4ef65cfe5c3cfbce6c56891795cd36a73cc37), [`7538afd`](https://github.com/TanStack/db/commit/7538afd2fa838340aaa63fca8b221154eb0b1572), [`a07cd73`](https://github.com/TanStack/db/commit/a07cd73739c1f135e658f38621de27f336004d11), [`6c1ca8f`](https://github.com/TanStack/db/commit/6c1ca8f8f9efe437d3cea61b5b9d0a086e2a5e34), [`30175be`](https://github.com/TanStack/db/commit/30175be483fa70799da579e2c407fb7ed9f2b435), [`4c39add`](https://github.com/TanStack/db/commit/4c39add293adb65b4f5537628849f97083a31531), [`1640de8`](https://github.com/TanStack/db/commit/1640de834bca0588f91432ea80a0f4569157e9dc), [`367ea7c`](https://github.com/TanStack/db/commit/367ea7c11e7dee5ca48ba524e55da2a6935d55fb), [`7d9ed02`](https://github.com/TanStack/db/commit/7d9ed02e085d11e871e4b6424d47e3c0d7073023), [`45eeef8`](https://github.com/TanStack/db/commit/45eeef81a7c64966473315558f46e8a53b00e462)]:
  - @tanstack/offline-transactions@1.2.0
  - @tanstack/db@1.0.0-rc.1
