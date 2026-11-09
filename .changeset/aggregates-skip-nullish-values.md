---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Leave `null` and `undefined` values out of `avg`, `min`, and `max` in live queries. `avg` now divides by the number of values instead of the number of rows, and `min` and `max` no longer report `0` for a nullish value. A group whose values are all nullish returns `null` from `min` and `max`, so their result type for an optional field now includes `null`; `sum` and `avg` still return `0`. In `@tanstack/db-ivm`, `sum` and `avg` leave out a `null` or `undefined` value, and `avg` returns `0` instead of `NaN` for a group with no values.
