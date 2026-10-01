---
'@tanstack/db': patch
---

Speed up apps that mount many small filtered live queries. Queries without includes keep their compiled pipeline instead of paying for include materialization, and eager subscriptions no longer build an abort error on every unsubscribe.
