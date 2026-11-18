---
'@tanstack/convex-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Preserve restored and accepted rows when Convex applies partial results. Stop native PowerSync tracking after row decoding fails and preserve unrestricted demand when filtered demands join. Require fresh TrailBase events to confirm each mutation.
