---
'@tanstack/db': patch
---

Fix reserved metadata before `fn.select()`, `fn.where()`, and `fn.having()` callbacks in live queries, Effects, and correlated includes. Preserve genuine source metadata, authored inline values, and selected output when compiled queries share a cache. Preserve every ordered window and joined-source publication dependency when one source feeds multiple compiled views or nested queries.
