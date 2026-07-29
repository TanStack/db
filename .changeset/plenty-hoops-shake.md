---
'@tanstack/db': patch
---

Fix: `materialize()` correlated subquery silently resolves to an empty array when the correlation predicate references a joined alias instead of the subquery's own `from` alias. The parent-key filter is now deferred until after joins when the correlation field lives on a joined source.
