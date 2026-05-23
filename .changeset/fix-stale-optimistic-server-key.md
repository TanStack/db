---
'@tanstack/db': patch
---

Fix stale optimistic rows persisting when sync confirms a different server-generated key. Previously, direct transactions (from `collection.insert()` etc.) had their optimistic rows exempted from stale-row cleanup, which prevented temp-key rows from being removed when the server returned a different primary key.
