---
'@tanstack/db': patch
---

Fix live queries that returned no rows when an include reused an alias from a joined `from()` subquery. Query optimization now keeps each source's identity, and compilation reads source inputs by identity instead of by alias. An include that reuses a parent subquery alias is now rejected with `DuplicateAliasInSubqueryError` instead of returning wrong rows. Two joins that share an alias in one query are also rejected.
