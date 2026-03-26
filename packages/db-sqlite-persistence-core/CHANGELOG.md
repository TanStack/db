# @tanstack/db-sqlite-persistence-core

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
