---
'@tanstack/db-sqlite-persistence-core': patch
---

In a follower tab, an on-demand load that the leader fetches now settles only after the follower applies the leader's committed rows. Before, the leader's reply could settle the load while the follower was still applying the broadcast commit, so a live query in the follower tab could first be ready without those rows. A follower load now also rejects when the leader's broadcast commit fails to apply in the follower, instead of settling without rows.

After a follower's cache claim rotates, a commit notice from the elected leader now counts as source evidence, so the follower shows the leader's rows. Before, the follower kept requesting the subset again and never showed them. `PersistedCollectionCoordinator` now requires `getLeaderId()`, which returns the elected leader's node ID, or `null` when it is unknown. The built-in coordinators already provide it. A custom coordinator must add it.
