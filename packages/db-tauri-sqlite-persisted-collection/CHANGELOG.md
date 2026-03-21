# @tanstack/db-tauri-sqlite-persisted-collection

## 0.1.1

### Patch Changes

- feat(persistence): add SQLite-based offline persistence for collections ([#1358](https://github.com/TanStack/db/pull/1358))

  Adds a new persistence layer that durably stores collection data in SQLite, enabling applications to survive page reloads and app restarts across browser, Node, mobile, desktop, and edge runtimes.

  **Core persistence (`@tanstack/db-sqlite-persisted-collection-core`)**
  - New package providing the shared SQLite persistence runtime: hydration, streaming, transaction tracking, and applied-tx pruning
  - SQLite core adapter with full query compilation, index management, and schema migration support
  - Portable conformance test contracts for runtime-specific adapters

  **Browser (`@tanstack/db-browser-wa-sqlite-persisted-collection`)**
  - New package for browser persistence via wa-sqlite backed by OPFS
  - Single-tab persistence with OPFS-based SQLite storage
  - `BrowserCollectionCoordinator` for multi-tab leader-election and cross-tab sync

  **Cloudflare Durable Objects (`@tanstack/db-cloudflare-do-sqlite-persisted-collection`)**
  - New package for SQLite persistence in Cloudflare Durable Objects runtimes

  **Node (`@tanstack/db-node-sqlite-persisted-collection`)**
  - New package for Node persistence via SQLite

  **Electron (`@tanstack/db-electron-sqlite-persisted-collection`)**
  - New package providing Electron main and renderer persistence bridge helpers

  **Expo (`@tanstack/db-expo-sqlite-persisted-collection`)**
  - New package for Expo persistence via `expo-sqlite`

  **React Native (`@tanstack/db-react-native-sqlite-persisted-collection`)**
  - New package for React Native persistence via op-sqlite
  - Adapter with transaction deadlock prevention and runtime parity coverage

  **Capacitor (`@tanstack/db-capacitor-sqlite-persisted-collection`)**
  - New package for Capacitor persistence via `@capacitor-community/sqlite`

  **Tauri (`@tanstack/db-tauri-sqlite-persisted-collection`)**
  - New package for Tauri persistence via `@tauri-apps/plugin-sql`

- Updated dependencies [[`e0df07e`](https://github.com/TanStack/db/commit/e0df07e1eb2eefbc829407f337cee1d443a7e9b6), [`d351c67`](https://github.com/TanStack/db/commit/d351c677d687e667450138f66ab3bd0e11e7e347)]:
  - @tanstack/db-sqlite-persisted-collection-core@0.1.1
