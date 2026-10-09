---
'@tanstack/db': patch
---

Make an ordered, limited live query that needs its whole source ready in the call that creates it when its source answers synchronously. This applies to a query with an inner join, a function filter, `distinct`, or a custom string comparator. Before, such a query over an eager source, or over a source whose `loadSubset` returned `true`, reported `loading` with no rows until a later task, while the same query without those clauses was ready at once. A source that returns a Promise, a later full-source fallback, repair, and truncate replay keep their asynchronous timing.
