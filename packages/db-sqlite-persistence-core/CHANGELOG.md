# @tanstack/db-sqlite-persistence-core

## 0.2.3

### Patch Changes

- Updated dependencies [[`d79b0cd`](https://github.com/TanStack/db/commit/d79b0cd3fd20c1f7e2525e90121752fb6bee314c), [`36fb29a`](https://github.com/TanStack/db/commit/36fb29ad7e906d39b6afdba2fd31e369c601bbb0), [`d79b0cd`](https://github.com/TanStack/db/commit/d79b0cd3fd20c1f7e2525e90121752fb6bee314c), [`ac09b11`](https://github.com/TanStack/db/commit/ac09b1177a100eafa85cba3cd09dd1f53f933ded)]:
  - @tanstack/db@0.6.11

## 0.2.2

### Patch Changes

- Updated dependencies [[`307fdf8`](https://github.com/TanStack/db/commit/307fdf80f522a39a50e316316b3b75ba27fd5e84)]:
  - @tanstack/db@0.6.10

## 0.2.1

### Patch Changes

- Use a safe `randomUUID` helper that falls back to `crypto.getRandomValues` when `crypto.randomUUID` is unavailable (non-secure browser contexts such as dev servers reached via a LAN IP over HTTP). Fixes #1541. ([#1593](https://github.com/TanStack/db/pull/1593))

- Updated dependencies [[`2147345`](https://github.com/TanStack/db/commit/2147345236ceee6e73d9fc6c0cdc2385833199fc), [`00389a4`](https://github.com/TanStack/db/commit/00389a47b258ad58fc3a03c5cc6f66957b9bd2d1)]:
  - @tanstack/db@0.6.9

## 0.2.0

### Minor Changes

- SQLite persistence wrappers now prune the `applied_tx` replay log by default so SQLite files no longer grow without bound. When prune options are omitted, wrappers that construct the shared SQLite core adapter apply `appliedTxPruneMaxRows: 1_000` and `appliedTxPruneMaxAgeSeconds: 86_400` (24h). Both remain overridable, and passing `0` disables that limit. The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS` from the shared SQLite core package and re-exported by wrapper packages. ([#1572](https://github.com/TanStack/db/pull/1572))

  The shared SQLite core adapter now treats `applied_tx` as a bounded replay cache during `pullSince` recovery. If a recovery request starts before the retained replay window, `pullSince` returns `requiresFullReload: true` instead of returning partial deltas.

### Patch Changes

- Updated dependencies [[`3827b62`](https://github.com/TanStack/db/commit/3827b62604bbfc970d80b57479c8da063d78e69d)]:
  - @tanstack/db@0.6.8

## 0.1.11

### Patch Changes

- Updated dependencies [[`ec59984`](https://github.com/TanStack/db/commit/ec59984dcd8610ad9651c2d32e1361143d44d3c9), [`6238a2d`](https://github.com/TanStack/db/commit/6238a2d80caf4d1cdecaf889fb66bd6ebcc7386a)]:
  - @tanstack/db@0.6.7

## 0.1.10

### Patch Changes

- Updated dependencies [[`4e9ab39`](https://github.com/TanStack/db/commit/4e9ab39241aae3ba17c8bddf744d566de411f9aa)]:
  - @tanstack/db@0.6.6

## 0.1.9

### Patch Changes

- Updated dependencies [[`232f228`](https://github.com/TanStack/db/commit/232f22845ddfe179a803a241f95a3375ae63a1fb), [`232f228`](https://github.com/TanStack/db/commit/232f22845ddfe179a803a241f95a3375ae63a1fb)]:
  - @tanstack/db@0.6.5

## 0.1.8

### Patch Changes

- Updated dependencies [[`1e69dd6`](https://github.com/TanStack/db/commit/1e69dd6fac7c9d8d7314af5ce18c33f2006c96b4)]:
  - @tanstack/db@0.6.4

## 0.1.7

### Patch Changes

- Updated dependencies [[`e29aab3`](https://github.com/TanStack/db/commit/e29aab3ece4420c6959202294777daa606c4b9e4), [`f4a9bd2`](https://github.com/TanStack/db/commit/f4a9bd28c613dc4757f279f292c9276f6a8e012e)]:
  - @tanstack/db@0.6.3

## 0.1.6

### Patch Changes

- Updated dependencies [[`3fe689a`](https://github.com/TanStack/db/commit/3fe689a4444d53a075a0dbe6e2649f8852137fc8), [`c314c36`](https://github.com/TanStack/db/commit/c314c36b8bd02f8be86865c13f31f817ce21dc66)]:
  - @tanstack/db@0.6.2

## 0.1.5

### Patch Changes

- Updated dependencies [[`8b7fb1a`](https://github.com/TanStack/db/commit/8b7fb1a18522b8d1c2adb46f5917305c7d99fc4a)]:
  - @tanstack/db@0.6.1

## 0.1.4

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1410](https://github.com/TanStack/db/pull/1410))

## 0.1.3

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1408](https://github.com/TanStack/db/pull/1408))

## 0.1.2

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1406](https://github.com/TanStack/db/pull/1406))

## 0.1.1

### Patch Changes

- fix(persistence): harden persisted startup, truncate metadata semantics, and resume identity matching ([#1380](https://github.com/TanStack/db/pull/1380))
  - Restore persisted wrapper `markReady` fallback behavior so startup failures do not leave collections stuck in loading state
  - Replace load cancellation reference identity tracking with deterministic load keys for `loadSubset` / `unloadSubset`
  - Document intentional truncate behavior where collection-scoped metadata writes are preserved across truncate transactions
  - Tighten SQLite `applied_tx` migration handling to only ignore duplicate-column add errors
  - Stabilize Electric shape identity serialization so persisted resume compatibility does not depend on object key insertion order

- feat(persistence): add SQLite-based offline persistence for collections ([#1358](https://github.com/TanStack/db/pull/1358))

  Adds a new persistence layer that durably stores collection data in SQLite, enabling applications to survive page reloads and app restarts across browser, Node, mobile, desktop, and edge runtimes.

  **Core persistence (`@tanstack/db-sqlite-persistence-core`)**
  - New package providing the shared SQLite persistence runtime: hydration, streaming, transaction tracking, and applied-tx pruning
  - SQLite core adapter with full query compilation, index management, and schema migration support
  - Portable conformance test contracts for runtime-specific adapters

  **Browser (`@tanstack/browser-db-sqlite-persistence`)**
  - New package for browser persistence via wa-sqlite backed by OPFS
  - Single-tab persistence with OPFS-based SQLite storage
  - `BrowserCollectionCoordinator` for multi-tab leader-election and cross-tab sync

  **Cloudflare Durable Objects (`@tanstack/cloudflare-durable-objects-db-sqlite-persistence`)**
  - New package for SQLite persistence in Cloudflare Durable Objects runtimes

  **Node (`@tanstack/node-db-sqlite-persistence`)**
  - New package for Node persistence via SQLite

  **Electron (`@tanstack/electron-db-sqlite-persistence`)**
  - New package providing Electron main and renderer persistence bridge helpers

  **Expo (`@tanstack/expo-db-sqlite-persistence`)**
  - New package for Expo persistence via `expo-sqlite`

  **React Native (`@tanstack/react-native-db-sqlite-persistence`)**
  - New package for React Native persistence via op-sqlite
  - Adapter with transaction deadlock prevention and runtime parity coverage

  **Capacitor (`@tanstack/capacitor-db-sqlite-persistence`)**
  - New package for Capacitor persistence via `@capacitor-community/sqlite`

  **Tauri (`@tanstack/tauri-db-sqlite-persistence`)**
  - New package for Tauri persistence via `@tauri-apps/plugin-sql`

- Updated dependencies [[`f60384b`](https://github.com/TanStack/db/commit/f60384b0fbde019865cbac5a7af341ff8a46d483), [`b8abc02`](https://github.com/TanStack/db/commit/b8abc0230096900746f92c51496489460b4d75e1), [`09c7afc`](https://github.com/TanStack/db/commit/09c7afc47a5ef3f3415ae601b6b00155ab64650b), [`bb09eb1`](https://github.com/TanStack/db/commit/bb09eb1eecbf680bb95a0bb08639f337e9982043), [`179d666`](https://github.com/TanStack/db/commit/179d66685449bcdf9f785c8765bc57cc19c2f7bd), [`43ecbfa`](https://github.com/TanStack/db/commit/43ecbfae5be5e59ffdce6c545d90ca5a810159e6), [`055fd94`](https://github.com/TanStack/db/commit/055fd94bd4654d27d5366af12a90da4c0e670fc0), [`055fd94`](https://github.com/TanStack/db/commit/055fd94bd4654d27d5366af12a90da4c0e670fc0), [`055fd94`](https://github.com/TanStack/db/commit/055fd94bd4654d27d5366af12a90da4c0e670fc0), [`055fd94`](https://github.com/TanStack/db/commit/055fd94bd4654d27d5366af12a90da4c0e670fc0), [`85f5435`](https://github.com/TanStack/db/commit/85f54355a426baefc88ccc55179e0cfcb4dac168), [`b65d8f7`](https://github.com/TanStack/db/commit/b65d8f767dafb1aeede26766c644f9ef0694f20c), [`e0df07e`](https://github.com/TanStack/db/commit/e0df07e1eb2eefbc829407f337cee1d443a7e9b6), [`9952921`](https://github.com/TanStack/db/commit/9952921e02ed8bca5653f0afa64862fc22ffbf9d), [`d351c67`](https://github.com/TanStack/db/commit/d351c677d687e667450138f66ab3bd0e11e7e347)]:
  - @tanstack/db@0.6.0
