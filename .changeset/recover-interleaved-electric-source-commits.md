---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Recover eager Electric collections from a fresh snapshot when interleaved source commits leave persisted rows inconsistent with the resume cursor. Keep cached rows visible while recovery restores the source state.
