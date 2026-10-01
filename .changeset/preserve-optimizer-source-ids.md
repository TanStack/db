---
'@tanstack/db': patch
---

Fix live queries returning no rows when a `from()` subquery joins a collection under an alias that is reused by an included (`materialize()`/includes) subquery. Optimizer copies of a collection source now keep its source identity, so the compiled subquery reads its own input instead of resolving another source's input by alias.
