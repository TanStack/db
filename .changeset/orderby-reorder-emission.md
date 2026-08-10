---
"@tanstack/db": patch
---

Fix live queries with `orderBy` not emitting a change when a row's position changes but its projected value does not. Previously, a query like `q.from(...).orderBy((r) => r.value).select((r) => ({ id: r.id }))` would silently keep the stale order after a reorder (the collection's value-diff suppressed the move because the projected value was unchanged), so `useLiveQuery` rendered the old order. Order-only moves are now detected from the orderBy operator's retract/insert pair and emitted directly, with no effect on collections without `orderBy` and no double-emit when the sort field is part of the projection.
