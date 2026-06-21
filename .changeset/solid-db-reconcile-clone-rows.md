---
"@tanstack/solid-db": patch
---

Fix `useLiveQuery` not propagating `toArray` include changes. When the upstream collection mutated parent rows in place (as it does when flushing `toArray` include values), Solid's `reconcile` short-circuited on the stable parent reference and the rendered `data` array kept showing the old include content. `syncDataFromCollection` now shallow-clones each row (and any array-valued field on it) before handing it to `reconcile`, so field-level diffing actually runs.
