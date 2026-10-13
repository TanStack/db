---
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
---

A live query over a progressive Electric collection is now ready once its own snapshot loads. Before, it stayed loading until the collection's background full sync completed, so `preload()`, `isReady`, and `useLiveSuspenseQuery` waited for the whole dataset even when the query's rows were already present. A live query now waits for an eager source to be ready and for an on-demand source's subset loads to settle. An on-demand source's own readiness no longer gates the query.

An effect with `skipInitial: true` ends its initial suppression at the same point. Before, an effect over an on-demand source that was already ready reported its initial rows as `enter` events.

A live query no longer enters an error state when a truncate of a lazily loaded source (a joined or included collection) aborts that source's pending load during the initial load. The truncate's replacement load now decides the demand.

A progressive Electric load that arrives while a must-refetch is replacing the initial snapshot now settles when the replacement completes. Before, it settled at once without loading rows, which the new readiness rule would have reported as a ready, empty query. After a stream error that `onError` retries, later progressive loads settle once the stream recovers.

`toArrayWhenReady()` and `stateWhenReady()` now resolve when `preload()` does. Before, they resolved as soon as the collection held any row, so on a live query they could resolve before the query was ready.
