---
"@tanstack/db-ivm": patch
---

Change the ivm indexes to use a three level `key->prefix->hash->value` structure, only falling back to structural hashing when there are multiple values for a single prefix. This removes all hashing during the initial run of a query delivering a 2-3x speedup.
