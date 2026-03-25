---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

fix(persistence): harden persisted startup, truncate metadata semantics, and resume identity matching

- Restore persisted wrapper `markReady` fallback behavior so startup failures do not leave collections stuck in loading state
- Replace load cancellation reference identity tracking with deterministic load keys for `loadSubset` / `unloadSubset`
- Document intentional truncate behavior where collection-scoped metadata writes are preserved across truncate transactions
- Tighten SQLite `applied_tx` migration handling to only ignore duplicate-column add errors
- Stabilize Electric shape identity serialization so persisted resume compatibility does not depend on object key insertion order
