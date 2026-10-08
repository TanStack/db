---
'@tanstack/db': patch
---

Preserve accepted LocalStorage mutations in write order and make manual transaction receipts wait for their storage writes even when `acceptMutations()` is not awaited. Reject reuse of one options object across direct Collection instances before it can silently drop mutations. Keep handler-free direct writes synchronous. Retain disjoint peer writes before storage events arrive and release storage listeners on Collection cleanup. Malformed or failed startup reads now put the Collection in an error state without replacing stored data. Failed write and event reads preserve durable and public rows, and `clearStorage()` publishes removal of accepted rows.
