---
'@tanstack/electric-db-collection': patch
---

Support nested property refs in WHERE/ORDER BY by compiling to PostgreSQL JSON/`jsonb` operators (`->` / `->>`).

Previously, multi-segment IR refs threw during SQL compilation. They now compile to safe JSON traversal: intermediate keys use `->`, the final key uses `->>` (text). Keys are emitted as SQL string literals with proper quote escaping.

**Limitation:** Nested paths apply only to JSON/`jsonb` extraction from a single root column—not Postgres composite types or dotted column names. If the physical column is not `json`/`jsonb`, the query may fail at runtime.

**Consumer impact:** No API changes. Queries that already used nested field refs against Electric subset loading can now generate valid SQL when the backing column is JSON/`jsonb`.
