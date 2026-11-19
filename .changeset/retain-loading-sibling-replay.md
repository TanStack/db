---
'@tanstack/db': patch
---

Keep the last complete live-query result while a new include demand loads under a sibling subscription's truncate replay. The demand now joins the publication barrier when it starts, so a sibling that settles first cannot publish an incomplete replacement. A failed held demand keeps that result until its own coverage recovers or its demand retires.
