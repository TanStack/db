---
'@tanstack/db-ivm': minor
---

Remove operators and helpers that `@tanstack/db` does not use. This is a breaking change for code that imports them from `@tanstack/db-ivm` directly:

- `topK`, `topKWithIndex`, `orderBy`, `orderByWithIndex` and `orderByWithFractionalIndexBase`. Use `orderByWithFractionalIndex` or `groupedOrderByWithFractionalIndex`.
- `innerJoin`, `leftJoin`, `rightJoin`, `fullJoin` and `antiJoin`. Use `join(other, type)`.
- The `count`, `negate`, `debug`, `filterBy`, `keyBy`, `unkey` and `rekey` operators. The `count` aggregate in `groupByOperators` is unchanged.
- The never-implemented piped aggregates in `groupBy`. An aggregate must supply `preMap` and `reduce`; an object with only `pipe` now fails when the graph runs, where it was ignored before.

The package also no longer depends on `sorted-btree`, which only an internal B+ tree top-K used.
