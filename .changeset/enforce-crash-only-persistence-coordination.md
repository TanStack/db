---
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electron-db-sqlite-persistence': patch
'@tanstack/db': patch
---

Require coordinators to route complete committed transactions through the per-collection persistence owner, with named fail-stop errors for indeterminate commits and durability failures. Add clone-safe remote-subset leases with exact release, recursive wire validation, and matching Browser and Electron coordination.
