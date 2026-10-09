---
'@tanstack/db': minor
---

Allow a nested query to reuse an ancestor's source alias. References captured in the ancestor keep their original source, while callbacks in the nested query read its local source. Start a descendant source declaration with a fresh `new Query().from(...)`; reusing one builder as both ancestor and descendant now gives a clear error. The same builder can still be placed in sibling includes. Aliases must still be unique within one query scope and across branches of one `unionAll()`. Captured whole-row and nested-object spreads now follow the same binding rule.
