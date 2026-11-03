---
'@tanstack/db-sqlite-persistence-core': patch
---

Retain run-only row metadata when an unrelated peer notice reloads a row recreated by an enclosing sync transaction. Keep that metadata nondurable unless the source explicitly writes it, while preserving peer replacement and delete behavior.
