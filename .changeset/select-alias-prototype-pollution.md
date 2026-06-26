---
'@tanstack/db': patch
---

Fix prototype pollution via `select()` alias paths. Aliases were split on `.` and walked into the result object without sanitization, so a query like `select(() => ({ ['__proto__.polluted']: ... }))` (or any segment matching `__proto__`, `prototype`, or `constructor`) could mutate `Object.prototype`. The select compiler now rejects unsafe alias path segments with a new `UnsafeAliasPathError`. Fixes #1584.
