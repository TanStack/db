---
'@tanstack/db': patch
---

Add `tx.when('settled')` to await transaction completion and `$hasPendingWrites` to identify rows with local optimistic writes. Deprecate `isPersisted.promise` and `$synced` while keeping them available for existing code.
