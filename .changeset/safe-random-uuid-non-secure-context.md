---
'@tanstack/db': patch
---

Fix `@tanstack/db` throwing `TypeError: crypto.randomUUID is not a function` in non-secure browser contexts. `crypto.randomUUID()` is restricted to secure contexts, so pages served over plain HTTP from a non-localhost host (such as a dev server reached via a LAN IP) could not insert into a collection, run a mutation, or open a transaction. UUID generation now centralises in `safeRandomUUID()` which prefers `crypto.randomUUID()` when available and falls back to RFC 4122 v4 via `crypto.getRandomValues()`.
