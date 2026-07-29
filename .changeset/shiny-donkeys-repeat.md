---
'@tanstack/db': patch
---

Fix: `materialize(q…findOne())` resolved to `null` instead of `undefined` when the correlation key itself was null. A null correlation key never reached the includes materialization step, so the compiler's `null` select placeholder leaked into the result, violating the typed `T | undefined` contract. Null correlation keys now resolve to the empty materialized value (`undefined` for `findOne()`, `[]` for arrays, `` for `concat`).
