---
'@tanstack/db-ivm': minor
---

Remove operators and helpers that `@tanstack/db` does not use. This is a breaking change for code that imports them from `@tanstack/db-ivm` directly:

- `topK`, `topKWithIndex`, `orderBy` and `orderByWithIndex`. Use `orderByWithFractionalIndex` or `groupedOrderByWithFractionalIndex`.
- `topKWithFractionalIndexBTree` and `loadBTree`. The package no longer depends on `sorted-btree`.
- `innerJoin`, `leftJoin`, `rightJoin`, `fullJoin` and `antiJoin`. Use `join(other, type)`.
- The `count`, `negate`, `debug`, `filterBy`, `keyBy`, `unkey` and `rekey` operators. The `count` aggregate in `groupByOperators` is unchanged.

The never-implemented piped aggregate support in `groupBy` is also removed.
