---
'@tanstack/db': patch
---

fix(db): canonicalize `inArray` value order in `normalizeExpressionPaths`

`inArray` is set membership, but `normalizeExpressionPaths` only canonicalized
ref paths, not value order — so the same value set in a different order produced
a distinct serialized predicate (and `loadSubset` queryKey / cache key for
adapters that key by it) and refetched identical data. `normalizeExpressionPaths`
now also sorts `in` value arrays, and the join lazy-load predicate (previously
built and combined without normalization) is routed through it so its keys are
canonicalized too.
