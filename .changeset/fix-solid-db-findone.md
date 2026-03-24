---
'@tanstack/solid-db': patch
---

fix(solid-db): support findOne in useLiveQuery

`useLiveQuery` with `.findOne()` returned an array instead of a single object. Updated type overloads to use `InferResultType<TContext>` so findOne queries return `T | undefined`, and added a runtime `singleResult` check to return the first element instead of the full array.

Fixes #1399
