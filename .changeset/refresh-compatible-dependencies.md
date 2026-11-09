---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/solid-db': patch
'@tanstack/trailbase-db-collection': patch
---

Update runtime dependencies while preserving the public API and CommonJS loading. Preserve Solid reactivity for own data fields and persist Electric snapshot resume checkpoints before subset loads succeed.
