---
'@tanstack/db': patch
---

Keep loading the lazy side of a join inside an include by its join keys when the query also filters one side with `where`. The filter now narrows each keyed `loadSubset` request (for example `type != 'generated' AND id IN (7, 8, 9)`) instead of replacing it, so an on-demand Collection no longer receives a request for every row that matches the filter, or for every row when the filter is on the other side.
