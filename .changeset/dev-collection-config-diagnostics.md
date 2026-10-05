---
'@tanstack/db': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Add development-only collection configuration validation with actionable errors and typo suggestions. Keep the validator and its internal diagnostic classes out of production application bundles.

Keep adapter-specific options inside PowerSync, RxDB, and TrailBase so collection configuration validation accepts their returned options.
