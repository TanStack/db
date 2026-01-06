---
'@tanstack/electric-db-collection': patch
---

Fix orphan transactions after `must-refetch` in progressive sync mode

When a `must-refetch` message was received in progressive mode, it started a transaction with `truncate()` but reset `hasReceivedUpToDate`, causing subsequent messages to be buffered instead of written to the existing transaction. On `up-to-date`, the atomic swap code would create a new transaction, leaving the first one uncommitted forever. This caused collections to become corrupted with undefined values.

The fix ensures that when a transaction is already started (e.g., from must-refetch), messages are written directly to it instead of being buffered for atomic swap.
