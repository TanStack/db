---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
---

Reject reuse of mutable persisted and LocalStorage sync options across Collections while keeping DbClient materializations independent. Pass fresh options to each direct `createCollection(...)`; DbClient descriptors remain reusable. Keep on-demand peer reloads and schema resets scoped to active demand and previously visible rows. Refresh or delete visible rows from durable evidence without replacing unconfirmed DbClient hydration rows or metadata. Resolve targeted peer updates from storage when their notice cannot distinguish a replacing insert from a partial update.
