---
"@tanstack/electric-db-collection": patch
---

Compile array-column membership (`inArray(value, arrayColumn)`) to `arrayColumn @> ARRAY[value]` instead of `value = ANY(arrayColumn)`. The two are equivalent, but only the containment form can use a GIN index, letting Postgres index-seek rather than scan. Membership in a literal value list (`inArray(column, [a, b])`) is unchanged and still compiles to `= ANY`.
