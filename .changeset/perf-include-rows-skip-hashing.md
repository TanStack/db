---
'@tanstack/db': patch
---

Live queries with includes hydrate faster. The rows that the include graph keeps in its join and reduce state now lead with their key, so the dataflow index tells them apart by key and hashes a whole row only when two rows share a key. On a 10,000-issue benchmark, an issue-to-creator include hydrates about 30% faster and a two-level include about 33% faster.
