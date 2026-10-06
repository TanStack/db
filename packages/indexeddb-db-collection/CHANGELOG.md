# @tanstack/indexeddb-db-collection

## 0.0.3

### Patch Changes

- Add IndexedDB-backed Collections with persistent local storage, cross-tab synchronization, and atomic writes. Include schema validation and utilities to import, export, clear, and inspect stored data. Publish imported snapshots atomically in receiving Collections, and confirm local writes even when another tab persists the same key while a mutation handler is pending. Automatic writes in one Collection persist in mutation order, including out-of-order handler completion. Respect Collection identity overrides, reconcile restored rows without version metadata, preserve native error causes, and prevent delayed deletion notifications from clearing a recreated Collection. Keep version metadata independent of wall-clock timestamps and expose separate schema output/input types on Collection utilities. ([#1179](https://github.com/TanStack/db/pull/1179))

  Managed connection closure marks affected Collections as errored while admitted
  writes finish truthfully. Administrative database deletion no longer publishes
  empty Collection snapshots; use the exported `deleteDatabase(name)` function.

  Keep low-level transaction settlement independent of application native event handlers.

  Capture validated import values before awaiting storage, and retain errored Collection snapshots after abnormal native closure. Support dedicated-worker persistence and optional blocked-event diagnostics for database open and deletion.

- Updated dependencies [[`d029833`](https://github.com/TanStack/db/commit/d0298332ec98ef99e8bf6e08cc32c8e1cd345fab), [`aa1b58e`](https://github.com/TanStack/db/commit/aa1b58e960421479c0fe1ffc243d49feada3c1c7), [`c3a4e4a`](https://github.com/TanStack/db/commit/c3a4e4a008ead8a2a910c9d965a1f3a77a0f2606), [`2376eb5`](https://github.com/TanStack/db/commit/2376eb581d66d1d52d2ab8fd1619060c74be5311), [`a37e69a`](https://github.com/TanStack/db/commit/a37e69ab6aa35fd6a2a72d727de2b5168d10b1a0), [`d029833`](https://github.com/TanStack/db/commit/d0298332ec98ef99e8bf6e08cc32c8e1cd345fab), [`d029833`](https://github.com/TanStack/db/commit/d0298332ec98ef99e8bf6e08cc32c8e1cd345fab), [`de8d0f1`](https://github.com/TanStack/db/commit/de8d0f1bffefb2885c4fe244c317c81d1ddc9117)]:
  - @tanstack/db@0.12.1
