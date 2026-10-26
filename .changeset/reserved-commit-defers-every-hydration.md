---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/db': patch
'@tanstack/electric-db-collection': patch
---

Keep a sync transaction that reserved its commit turn from failing when a persisted hydration starts while it is open. Before, only a subset load admitted during the reservation waited for the commit. A subset load admitted earlier, a reload or reset from a peer tab's notice, sequence-gap recovery, or a hydration that a shared scheduler held past its turn advanced the hydration cycle, and the commit then rejected with `a persisted sync transaction cannot cross a hydration cycle`. Electric reserves every stream transaction, so a deploy that made several tabs refetch at once could put their Collections into `error`. Each of these hydrations now waits outside the apply mutex until the reserved transaction commits, then starts. While it waits, readers keep the rows from before it. The `reserveCommitTurn` contract now covers every persisted hydration.

A peer reset now applies in arrival order with peer commit notices, so a commit from before the reset can no longer publish a row that the reset removed.

Electric now abandons its open transaction when its stream stops for good, so hydrations that wait for that transaction can run.
