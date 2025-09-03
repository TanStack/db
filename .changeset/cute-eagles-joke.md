---
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
---

fix: include all CollectionConfig properties in collection type definitions

Collection packages were only explicitly including some properties from CollectionConfig, missing gcTime and other standard collection properties. Updated both packages to extend Omit<CollectionConfig<...>, ...> to inherit all base properties including gcTime, startSync, autoIndex, etc.
