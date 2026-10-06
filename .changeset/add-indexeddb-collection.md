---
'@tanstack/indexeddb-db-collection': patch
---

Add IndexedDB-backed Collections with persistent local storage, cross-tab synchronization, and atomic writes. Include schema validation and utilities to import, export, clear, and inspect stored data. Publish imported snapshots atomically in receiving Collections, and confirm local writes even when another tab persists the same key while a mutation handler is pending. Automatic writes in one Collection persist in mutation order, including out-of-order handler completion. Respect Collection identity overrides, reconcile restored rows without version metadata, preserve native error causes, and prevent delayed deletion notifications from clearing a recreated Collection.
