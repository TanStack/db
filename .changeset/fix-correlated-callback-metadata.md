---
'@tanstack/db': patch
---

Fix reserved metadata before `fn.select()`, `fn.where()`, and `fn.having()` callbacks in live queries, Effects, and correlated includes. Preserve genuine source metadata, authored inline values, and selected output when compiled queries share a cache. Preserve ordered loading for every window when one source feeds multiple compiled views.
