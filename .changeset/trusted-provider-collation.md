---
'@tanstack/db': patch
---

Add `trustProviderOrder` to custom string collations, so an on-demand query can page through a backend that orders strings with the same comparator. `gt`, `gte`, `lt` and `lte` accept an optional collation for string cursors.
