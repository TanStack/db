---
'@tanstack/db': patch
---

Preserve accepted LocalStorage mutations in author order, retain disjoint peer writes before storage events arrive, and release storage listeners on Collection cleanup. Manual transactions now select mutations by Collection identity after sync starts.
