---
'@tanstack/db-sqlite-persistence-core': patch
---

Answer a repeat acquisition of an already-loaded subset synchronously. The persisted sync wrapper declared its `loadSubset` `async`, so it returned a promise even when the rows were already in the collection and the wrapped sync had answered `true`; a live query over such a subset was therefore never ready at construction, which left `useLiveSuspenseQuery` re-suspending without limit. Repeat acquisitions now skip the redundant store read, take a lease of their own so releasing a sibling cannot end one still in use, and fall back to the asynchronous path whenever the rows could have gone away — after a source truncate, after the last acquisition is released, during a reload, and before startup settles. Concurrent acquisitions of the same subset still read the store once each; sharing those is a separate change.
