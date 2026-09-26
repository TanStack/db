# @tanstack/react-native-db-sqlite-persistence

## 0.2.24

### Patch Changes

- Decode op-sqlite row arrays and columnar results losslessly, and reject malformed or unknown result envelopes instead of treating them as empty results. ([#1848](https://github.com/TanStack/db/pull/1848))
  Custom wrappers that return a genuinely ambiguous bare array can set `arrayResultMode` to `rows` or `statement-results`; without that authoritative mode, the driver rejects instead of silently reshaping data.

- Preserve persisted resume integrity with atomic SQLite baseline evidence and stale-writer rejection, expose persistence sync metadata as one versioned capability, and refresh uncertified Electric baselines before publishing resumed data. ([#1846](https://github.com/TanStack/db/pull/1846))

  This changes the public persistence contracts: custom `PersistenceAdapter` implementations must now implement `loadResumeSnapshot`, and `SyncMetadataApi.persistence` is required with `null` explicitly representing no persistence. Custom sync wrappers that receive metadata must forward `metadata.persistence` unchanged so consumers receive either that sentinel or the complete versioned capability. A direct sync invocation may still omit the optional metadata object entirely, which consumers treat as no persistence. The Electron bridge now transports the atomic resume snapshot through IPC protocol v2; Electron main and renderer integrations must upgrade together because mixed v1/v2 peers fail closed. Node and React Native persistence instances that wrap one database handle now share transaction admission so concurrent collection startup cannot overlap transactions on that connection.

- Updated dependencies [[`5108acf`](https://github.com/TanStack/db/commit/5108acf47a0724691a06af8a660014776f9cf716), [`fef53f8`](https://github.com/TanStack/db/commit/fef53f8be7f1cb68f00639a4c3206a6598663de4), [`4b9617c`](https://github.com/TanStack/db/commit/4b9617cfd36c4f0ec14ad55dd6eaa92a2e8c9a8d), [`5218f0c`](https://github.com/TanStack/db/commit/5218f0c385f61ccfa08ff366fb6f487528702017), [`98639f0`](https://github.com/TanStack/db/commit/98639f03a0071ab712d2277ee7e59e33ec6c760d), [`2781581`](https://github.com/TanStack/db/commit/27815817c56b3bca1823703dbd9893a0ef86f6d2), [`3d96614`](https://github.com/TanStack/db/commit/3d96614547cca8b085e89d628c7aa585ac7ddc88), [`510cb53`](https://github.com/TanStack/db/commit/510cb538c4706e21a4d70046bf2ab2753f47bfa8)]:
  - @tanstack/db-sqlite-persistence-core@0.3.0

## 0.2.23

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.23

## 0.2.22

### Patch Changes

- Updated dependencies [[`a378bd3`](https://github.com/TanStack/db/commit/a378bd3a65f6b9ed0c9a85f793b7dc2e2a59a313), [`ad043b7`](https://github.com/TanStack/db/commit/ad043b7455a5bdc549c36833bc72ddbe9ce8afed)]:
  - @tanstack/db-sqlite-persistence-core@0.2.22

## 0.2.21

### Patch Changes

- Updated dependencies [[`cfb01ce`](https://github.com/TanStack/db/commit/cfb01cee34de7d0378e008dc8c01c1df5253c1e2)]:
  - @tanstack/db-sqlite-persistence-core@0.2.21

## 0.2.20

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.20

## 0.2.19

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.19

## 0.2.18

### Patch Changes

- Updated dependencies [[`8c5838d`](https://github.com/TanStack/db/commit/8c5838ddd5f08b3c298d4458cae1ce599af80624)]:
  - @tanstack/db-sqlite-persistence-core@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.16

## 0.2.15

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [[`4b9e8cd`](https://github.com/TanStack/db/commit/4b9e8cdf79551734cf526e6fa4bbdba42ec94575)]:
  - @tanstack/db-sqlite-persistence-core@0.2.13

## 0.2.12

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.11

## 0.2.10

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.10

## 0.2.9

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [[`f7da776`](https://github.com/TanStack/db/commit/f7da77660b16cbfe30817fb5c938267d696c8d1c)]:
  - @tanstack/db-sqlite-persistence-core@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`00389a4`](https://github.com/TanStack/db/commit/00389a47b258ad58fc3a03c5cc6f66957b9bd2d1)]:
  - @tanstack/db-sqlite-persistence-core@0.2.1

## 0.2.0

### Minor Changes

- SQLite persistence wrappers now prune the `applied_tx` replay log by default so SQLite files no longer grow without bound. When prune options are omitted, wrappers that construct the shared SQLite core adapter apply `appliedTxPruneMaxRows: 1_000` and `appliedTxPruneMaxAgeSeconds: 86_400` (24h). Both remain overridable, and passing `0` disables that limit. The defaults are exported as `DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS` and `DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS` from the shared SQLite core package and re-exported by wrapper packages. ([#1572](https://github.com/TanStack/db/pull/1572))

  The shared SQLite core adapter now treats `applied_tx` as a bounded replay cache during `pullSince` recovery. If a recovery request starts before the retained replay window, `pullSince` returns `requiresFullReload: true` instead of returning partial deltas.

### Patch Changes

- Updated dependencies [[`58edb26`](https://github.com/TanStack/db/commit/58edb26e87de8d992594119e39a9daa6f80620f2)]:
  - @tanstack/db-sqlite-persistence-core@0.2.0

## 0.1.11

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-sqlite-persistence-core@0.1.5

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
