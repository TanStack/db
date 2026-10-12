---
'@tanstack/db-ivm': patch
---

Structural hashing now gives equal objects the same hash when two of their keys are distinct strings that locale collation ranks as equal, such as a precomposed `Å` and `A` followed by a combining ring. Before, the hash sorted keys with `localeCompare`, so the hash of such an object depended on the order its keys were inserted, and two equal rows could fail to consolidate in a live query. Keys now sort by UTF-16 code unit, which is a total order. Hashing also writes whole 32-bit words to the hash stream when it can, which makes hashing rows faster without changing any digest.
