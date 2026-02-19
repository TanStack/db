---
'@tanstack/angular-db': patch
---

Fix `injectLiveQuery` with `findOne()` returning an array instead of a single object, and add proper type overloads so TypeScript correctly infers `Signal<T | undefined>` for `findOne()` queries
