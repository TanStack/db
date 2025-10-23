---
"@tanstack/query-db-collection": patch
---

Fix writeDelete/writeUpdate validation to check synced store only

Fixed issue where calling `writeDelete()` or `writeUpdate()` inside mutation handlers (like `onDelete`) would throw errors when optimistic updates were active. These write operations now correctly validate against the synced store only, not the combined view (synced + optimistic).

This allows patterns like calling `writeDelete()` inside an `onDelete` handler to work correctly, enabling users to write directly to the synced store while the mutation is being persisted to the backend.

Fixes #706
