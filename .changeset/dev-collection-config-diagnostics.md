---
'@tanstack/db': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Add development-only collection configuration diagnostics. Missing or invalid core options throw actionable errors. Extra adapter properties remain accepted without warnings, except for likely misspellings: casing mistakes or adjacent letter swaps in option names with at least five characters. A suggestion is suppressed when the correctly named option is already present. Keep the validator, warnings, and internal diagnostic classes out of production application bundles.

Keep adapter-specific options inside PowerSync, RxDB, and TrailBase. Update the adapter guide to keep conversions in adapter code and place rowUpdateMode inside the sync config.
