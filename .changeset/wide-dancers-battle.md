---
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

Add explicit collection readiness detection with `isReady()` and `markReady()`

- Add `isReady()` method to check if a collection is ready for use
- Add `onFirstReady()` method to register callbacks for when collection becomes ready
- Add `markReady()` to SyncConfig interface for sync implementations to explicitly signal readiness
- Replace `onFirstCommit()` with `onFirstReady()` for better semantics
- Update status state machine to allow `loading` → `ready` transition for cases with no data to commit
- Update all sync implementations (Electric, Query, Local-only, Local-storage) to use `markReady()`
- Improve error handling by allowing collections to be marked ready even when sync errors occur

This provides a more intuitive and ergonomic API for determining collection readiness, replacing the previous approach of using commits as a readiness signal.
