---
'@tanstack/db': patch
---

Speed up apps that mount many small filtered live queries. Queries without includes keep their compiled pipeline instead of paying for include materialization, eager subscriptions no longer build an abort error on every unsubscribe, a filtered subscription skips source batches that cannot match its `eq` condition, and unindexed snapshots reject rows by that condition before copying them. With 240 `eq`-filtered live queries, mounting is about 2x faster (indexed) to 2.5x faster (unindexed), and a 50-row update batch is about 2.7x faster.
