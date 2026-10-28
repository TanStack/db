---
'@tanstack/db': patch
---

A query that joins and includes the same source has two subscriptions to it. Their truncate replays now share one barrier, so neither publishes while the other still loads. When a lazy demand of either fails while a failed replay of the source holds the query's results, the query keeps its last complete result until a later replay of that source succeeds. Before, retiring the other replay's failed demand could publish the window without that demand's rows.

Some sources refetch and then report that their pages shifted. An ordered window over such a source no longer skips a row tied with the refetched first page's new end. When the report shows that the page's end moved, the window repairs its first page. It no longer trusts a row that an older tie request installed.

A window move made while a truncate replay holds a live query's results now applies after that replay, even when a newer truncate discards it. Before, the move could reject, and an older move's window stayed. A reload of the query or of a source still ends the move.

An ordered, limited query over a source without an order index can read too few rows to fill its window. A join that drops rows can cause this. It no longer reads the whole source then. It reads a prefix twice as long instead. It grows again while that adds rows, so every request stays bounded.
