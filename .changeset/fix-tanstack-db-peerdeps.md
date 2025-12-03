---
"@tanstack/query-db-collection": patch
"@tanstack/offline-transactions": patch
---

Use regular dependency for @tanstack/db instead of peerDependency to match the standard pattern used by other TanStack DB packages and prevent duplicate installations
