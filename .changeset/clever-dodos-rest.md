---
'@tanstack/db': patch
---

Fix subscriptions not re-requesting data after truncate in on-demand sync mode. When a must-refetch occurs, subscriptions now buffer changes and re-request their previously loaded subsets, preventing a flash of missing content.

Key improvements:

- Buffer changes atomically: deletes and inserts are emitted together in a single callback
- Correct event ordering: defers loadSubset calls to a microtask so truncate deletes are buffered before refetch inserts
- Gated on on-demand mode: only buffers when there's an actual loadSubset handler
- Fixes delete filter edge case: skips delete filter during truncate buffering when `sentKeys` is empty
