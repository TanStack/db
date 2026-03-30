---
'@tanstack/db': patch
---

fix: default getKey on live query collections fails when used as a source in chained collections

The default WeakMap-based getKey breaks when enriched change values (with virtual props like $synced, $origin, $key) are passed through chained live query collections. The enriched objects are new references not found in the WeakMap, causing all items to resolve to key `undefined` and collapse into a single item. Falls back to `item.$key` when the WeakMap lookup misses.
