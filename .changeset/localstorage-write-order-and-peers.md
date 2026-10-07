---
'@tanstack/db': patch
---

Preserve accepted LocalStorage mutations in write order, including awaited manual acceptance, and keep handler-free direct writes synchronous. Retain disjoint peer writes before storage events arrive and release storage listeners on Collection cleanup. Malformed or failed startup reads now put the Collection in an error state without replacing stored data. Failed write and event reads preserve durable and public rows, and `clearStorage()` publishes removal of accepted rows.
