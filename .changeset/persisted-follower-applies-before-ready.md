---
'@tanstack/db-sqlite-persistence-core': patch
---

In a follower tab, an on-demand load that the leader fetches now settles only after the follower applies the leader's committed rows. Before, the leader's reply could settle the load while the follower was still applying the broadcast commit, so a live query in the follower tab could first be ready without those rows. A follower load now rejects, and releases its acquisition, when the leader's broadcast commit fails to apply in the follower, instead of settling without rows.

After a follower's cache claim rotates, it holds the new generation's commit notices until it has reacquired its active demand, then applies them. Before, the follower kept requesting the subset again and never showed the leader's rows. A follower also keeps commit notices that arrive while its cache claim is expired, and it requests its demand again after the leader resets the collection, instead of showing an empty ready result.
