---
'@tanstack/db-ivm': patch
---

Structural hashing now gives equal objects the same hash when two of their keys are distinct strings that locale collation ranks as equal, such as a precomposed `Å` and `A` followed by a combining ring. Before, the hash sorted keys with `localeCompare`, so the hash of such an object depended on the order its keys were inserted, and two equal rows could fail to consolidate in a live query. Keys now sort by UTF-16 code unit, which is a total order. This changes the digest of objects whose keys sort differently by code unit than by locale, for example `{ a: 1, B: 2 }`. Digests are per process, so no stored value depends on them. Hashing also writes whole 32-bit words to the hash stream, which makes hashing rows faster. The stream still hashes the same bytes.
