---
'@tanstack/db': patch
---

Keep a live query running when a lazy join or include load fails as part of a source truncate. The truncate's replay fails instead, and the query keeps its last complete result until a later replay of that source succeeds. Before, the query could end in error 228, for example when a truncate made an ordered window demand a row that it never showed. A load that fails before the query first becomes ready still ends it.

A query that joins and includes the same source has two subscriptions to it. Their truncate replays now share one barrier. A lazy demand that fails while either replay still loads, or after either replay failed, no longer ends the query.

A source whose `loadSubset` throws instead of returning a rejected promise now fails a truncate replay the same way. Before, a throw during a replay could end the query.

An aborted subset request that a source rejects with `AbortError`, as the source contract asks, no longer ends a live query. A truncate replay or newer demand decides that request instead.

Some sources refetch and then report that their pages shifted. An ordered window over such a source no longer skips a row tied with the refetched first page's new end. When the report shows that the page's end moved, the window repairs its first page. It no longer trusts a row that an older tie request installed.

A window move made while a truncate replay holds a live query's results now applies after that replay, even when a newer truncate discards it. Before, the move could reject, and an older move's window stayed.

An ordered, limited query over a source without an order index can read too few rows to fill its window. A join that drops rows can cause this. It no longer reads the whole source then. It reads a prefix twice as long instead. It grows again while that adds rows, so every request stays bounded.
