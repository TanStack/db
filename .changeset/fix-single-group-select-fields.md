---
'@tanstack/db': patch
---

An aggregate query without `groupBy` no longer drops its other select fields silently. Inside an include, a literal or a parent field now appears beside the aggregate, for example `{ n: count(c.id), px: issue.x }`. Before, `px` was `undefined`. A field of the query's own source has no single value for the group, so it now throws `NonAggregateExpressionNotInGroupByError`, as it already did with `groupBy`. Before, it was `undefined`. This also applies to a source field outside the aggregates of a wrapped, conditional or nested value, such as `add(count(c.id), c.v)`, and to a spread such as `{ ...c, n: count(c.id) }`. Aggregate the field (for example with `max`) or add it to `groupBy`.

With `groupBy`, a literal or a parent field beside the aggregate is now accepted and published, because it has one value per group. Before, it threw. A nested include in a grouped or aggregate select now throws. Before, it was `null` without `groupBy`.

A HAVING condition that compares a group key, such as `having(({ c }) => eq(c.k, 'a'))`, now keeps the matching groups. Before, it removed every group. A HAVING condition that reads another source field outside an aggregate now throws `NonAggregateExpressionNotInGroupByError`. Before, it removed every group. A grouped select that repeats a `groupBy` expression with an array, Date or `NaN` literal no longer throws, and a parent field is accepted when the include's source reuses the parent's alias. The error message no longer says "in SELECT", because it also applies to HAVING. An aggregate query without `groupBy` whose select only wraps its aggregate, such as `{ n: add(count(c.id), 1) }`, now accepts HAVING. Before, it threw `HavingRequiresGroupByError`.
