---
'@tanstack/db': patch
---

Simplify the mutation draft proxy and share one equality walker with `deepEquals`. Revert detection and `deepEquals` results do not change, and draft writes are faster. A typical app bundle is about 460 B smaller with gzip.

A function stored in a row is now returned as stored when read from a draft, by any read path. Before, the draft returned a bound copy, so `draft.handler === handler` was false. A stored method also saw a private copy as `this`, so writes it made through `this` were not tracked and `collection.update` dropped them. Those writes are now tracked.
