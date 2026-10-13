---
'@tanstack/db-sqlite-persistence-core': patch
---

In a follower tab, an on-demand load that the leader fetches now settles only after the follower applies the leader's committed rows. Before, the leader's reply could settle the load while the follower was still applying the broadcast commit, so a live query in the follower tab could first be ready without those rows. A follower load now rejects, and releases its acquisition, when the leader's broadcast commit fails to apply in the follower, instead of settling without rows.

A follower now replaces its rows in place when it applies the leader's commits, instead of replaying its demand to a leader that commits again on every load. It also keeps commit notices that arrive while its cache claim is expired, and it requests its demand again after the leader resets the collection, instead of showing an empty ready result.
