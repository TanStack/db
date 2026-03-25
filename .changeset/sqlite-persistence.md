---
'@tanstack/db': patch
'@tanstack/db-persistence-core': patch
'@tanstack/browser-db-persistence': patch
'@tanstack/cloudflare-durable-objects-db-persistence': patch
'@tanstack/node-db-persistence': patch
'@tanstack/electron-db-persistence': patch
'@tanstack/expo-db-persistence': patch
'@tanstack/react-native-db-persistence': patch
'@tanstack/capacitor-db-persistence': patch
'@tanstack/tauri-db-persistence': patch
---

feat(persistence): add SQLite-based offline persistence for collections

Adds a new persistence layer that durably stores collection data in SQLite, enabling applications to survive page reloads and app restarts across browser, Node, mobile, desktop, and edge runtimes.

**Core persistence (`@tanstack/db-persistence-core`)**

- New package providing the shared SQLite persistence runtime: hydration, streaming, transaction tracking, and applied-tx pruning
- SQLite core adapter with full query compilation, index management, and schema migration support
- Portable conformance test contracts for runtime-specific adapters

**Browser (`@tanstack/browser-db-persistence`)**

- New package for browser persistence via wa-sqlite backed by OPFS
- Single-tab persistence with OPFS-based SQLite storage
- `BrowserCollectionCoordinator` for multi-tab leader-election and cross-tab sync

**Cloudflare Durable Objects (`@tanstack/cloudflare-durable-objects-db-persistence`)**

- New package for SQLite persistence in Cloudflare Durable Objects runtimes

**Node (`@tanstack/node-db-persistence`)**

- New package for Node persistence via SQLite

**Electron (`@tanstack/electron-db-persistence`)**

- New package providing Electron main and renderer persistence bridge helpers

**Expo (`@tanstack/expo-db-persistence`)**

- New package for Expo persistence via `expo-sqlite`

**React Native (`@tanstack/react-native-db-persistence`)**

- New package for React Native persistence via op-sqlite
- Adapter with transaction deadlock prevention and runtime parity coverage

**Capacitor (`@tanstack/capacitor-db-persistence`)**

- New package for Capacitor persistence via `@capacitor-community/sqlite`

**Tauri (`@tanstack/tauri-db-persistence`)**

- New package for Tauri persistence via `@tauri-apps/plugin-sql`
