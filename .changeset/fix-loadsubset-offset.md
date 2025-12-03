---
"@tanstack/db": patch
---

fix(db): pass offset to loadSubset for proper pagination support

Fixed an issue where the `offset` parameter was not being passed to `loadSubset`, causing direct pagination (e.g., fetching page 400 with 200 items) to load all rows from the beginning instead of just the requested page. The `LoadSubsetOptions` type now includes an `offset` property, and `parseLoadSubsetOptions` helper also returns the offset value.
