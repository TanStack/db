# @tanstack/capacitor-db-sqlite-persistence

## 0.1.4

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1410](https://github.com/TanStack/db/pull/1410))

- Updated dependencies [[`b779b4e`](https://github.com/TanStack/db/commit/b779b4ec127dd3f6a2fef965c52d4ee876144d8b)]:
  - @tanstack/db-sqlite-persistence-core@0.1.4

## 0.1.3

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1408](https://github.com/TanStack/db/pull/1408))

- Updated dependencies [[`287673d`](https://github.com/TanStack/db/commit/287673da28a9b760fa3f3b7dd993297c9217c894)]:
  - @tanstack/db-sqlite-persistence-core@0.1.3

## 0.1.2

### Patch Changes

- Fix workspace: dependency links that were incorrectly published to npm ([#1406](https://github.com/TanStack/db/pull/1406))

- Updated dependencies [[`99ad6b5`](https://github.com/TanStack/db/commit/99ad6b598729bd3bd7aef70b8f06dc4635c1f8ce)]:
  - @tanstack/db-sqlite-persistence-core@0.1.2

## 0.1.1

### Patch Changes

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

- Updated dependencies [[`e0df07e`](https://github.com/TanStack/db/commit/e0df07e1eb2eefbc829407f337cee1d443a7e9b6), [`d351c67`](https://github.com/TanStack/db/commit/d351c677d687e667450138f66ab3bd0e11e7e347)]:
  - @tanstack/db-sqlite-persistence-core@0.1.1
