---
'@tanstack/db': patch
---

Enhanced multi-column orderBy support with lazy loading and composite cursor optimization.

**Changes:**

- Create index on first orderBy column even for multi-column orderBy queries, enabling lazy loading with first-column ordering
- Pass multi-column orderBy to loadSubset with precise composite cursors (e.g., `or(gt(col1, v1), and(eq(col1, v1), gt(col2, v2)))`) for backend optimization
- Use wide bounds (first column only) for local index operations to ensure no rows are missed
- Use precise composite cursor for sync layer loadSubset to minimize data transfer

**Benefits:**

- Multi-column orderBy queries with limit now support lazy loading (previously disabled)
- Sync implementations (like Electric) can optimize queries using composite indexes on the backend
- Local collection uses first-column index efficiently while backend gets precise cursor
