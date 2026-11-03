---
'@tanstack/rxdb-db-collection': patch
---

Persist writes to RxDB in the order the application made them. A write now starts only after the earlier write on the same collection fulfills or rejects. Before, a later write could reach RxDB while an earlier one was still pending. A rejected delete now rejects with RxDB's `RxError` for the write error, as a rejected insert does, instead of with an array of write errors.
