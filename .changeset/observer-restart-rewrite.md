---
'@tanstack/db': patch
---

Show a row that a restarted sync run writes again after cleanup. A live-query observer (and so `useLiveQuery` in every framework adapter) that stayed subscribed through a Collection's cleanup and restart showed no row when the new sync run wrote a row equal to one it showed before cleanup, or when an on-demand restart reloaded it. The observer's Collection subscription now keeps none of the rows from before cleanup.
