---
'@tanstack/db-sqlite-persistence-core': patch
---

In a follower tab, an on-demand load that the leader fetches now settles only after the follower applies the leader's committed rows. Before, the leader's reply could settle the load while the follower was still applying the broadcast commit, so a live query in the follower tab could first be ready without those rows.
