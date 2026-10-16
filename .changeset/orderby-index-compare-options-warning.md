---
'@tanstack/db': patch
---

Report a `compareOptions` mismatch in the `orderBy` with `limit` lazy-loading warning. When an index on the ordered field exists but was built with different `compareOptions` (for example `nulls: 'last'` against an index with the default `nulls: 'first'`), the warning now says so and shows the `createIndex` call with matching `compareOptions`, instead of claiming that no index exists.
