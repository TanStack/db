---
'@tanstack/db': patch
---

An aggregate query without `groupBy` no longer drops its other select fields silently. Inside an include, a literal or a parent field now appears beside the aggregate, for example `{ n: count(c.id), px: issue.x }`. Before, `px` was `undefined`. A field of the query's own source has no single value for the group, so it now throws `NonAggregateExpressionNotInGroupByError`, as it already did with `groupBy`. Before, it was `undefined`. This also applies to a source field outside the aggregates of a wrapped, conditional or nested value, such as `add(count(c.id), c.v)`, and to a spread such as `{ ...c, n: count(c.id) }`. Aggregate the field (for example with `max`) or add it to `groupBy`.

With `groupBy`, a literal or a parent field beside the aggregate is now accepted and published, because it has one value per group. Before, it threw. A nested include beside an aggregate now throws, with or without `groupBy`. Before, it was `null` without `groupBy`.
