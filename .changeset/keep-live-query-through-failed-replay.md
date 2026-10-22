---
'@tanstack/db': patch
---

Keep a live query running when a lazy join or include load fails as part of a source truncate. The truncate's replay fails instead, and the query keeps its last complete result until a later replay of that source succeeds. Before, the query could end in error 228, for example when a truncate made an ordered window demand a row that it never showed. A load that fails before the query first becomes ready still ends it.

An aborted subset request that a source rejects with `AbortError`, as the source contract asks, no longer ends a live query. A truncate replay or newer demand decides that request instead.
