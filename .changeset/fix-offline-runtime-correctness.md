---
'@tanstack/offline-transactions': patch
---

Fix offline replay filtering so it preserves concurrently admitted and issued transactions, use React Native's subscribed connectivity snapshot as the initial authority, and preserve Temporal scalar identity through storage and restart when the runtime provides `globalThis.Temporal`. Filtered replay work now settles and rolls back after each successful durable removal even when a sibling removal fails, retry scheduling remains live when an outbox update or removal fails, and metadata keeps standard `toJSON(key)` replacement semantics. Recognized native scalars now fail before storage when the matching global constructor is unavailable.

Offline storage compatibility: new records use `valueEncoding: 3`. Older clients cannot read these records, so do not run old and new clients against the same pending outbox or downgrade while new records remain pending.
