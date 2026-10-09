---
'@tanstack/db': patch
---

An aggregate query without `groupBy` no longer drops its other select fields silently. Inside an include, a literal or a parent field now appears beside the aggregate, for example `{ n: count(c.id), px: issue.x }`. Before, `px` was `undefined`. A field of the query's own source has no single value for the group, so it now throws `NonAggregateExpressionNotInGroupByError`, as it already did with `groupBy`. Before, it was `undefined`. Aggregate the field (for example with `max`) or add it to `groupBy`.
