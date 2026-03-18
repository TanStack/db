---
'@tanstack/db-electron-sqlite-persisted-collection': patch
'@tanstack/db-node-sqlite-persisted-collection': patch
---

feat(persistence): add Electron and Node.js SQLite persisted collection packages

**Electron (`@tanstack/db-electron-sqlite-persisted-collection`)**

- New package for Electron persistence via better-sqlite3
- IPC bridge for secure main-process SQLite access from renderer
- `ElectronCollectionCoordinator` for coordinating persistence across Electron windows

**Node.js (`@tanstack/db-node-sqlite-persisted-collection`)**

- New package for Node.js persistence via the built-in `node:sqlite` module
- Lightweight driver and persistence layer for server-side and CLI use cases
