---
'@tanstack/query-db-collection': patch
---

fix: invalidate stale predicate-scoped cache entries on manual-sync writes

In `syncMode: 'on-demand'`, manual-sync writes (`writeInsert`/`writeUpdate`/`writeDelete`/`writeUpsert`/`writeBatch`) used to overwrite every cache entry under the collection's `queryKey` with the full post-write `syncedData` snapshot — regardless of the predicate that originally produced each entry. For stale entries (no live observer) within `gcTime`, this stamped them with rows that didn't satisfy their original `where`. A subsequent cache-hit re-subscribe re-applied those wrong rows via `applySuccessfulResult`, the per-subscription `where` filter discarded them, and the subscriber received `[]` for predicates whose matching rows still existed in the source.

Stale cache entries are now invalidated (`removeQueries`) instead of overwritten, forcing the next subscribe to re-run `queryFn` against the source of truth. Active entries continue to receive the full snapshot (predicate scoping for the consumer is enforced downstream by `subscribeChanges`'s `where`). The original ghost-row protection is preserved because deleted rows no longer reappear from a stale snapshot.
