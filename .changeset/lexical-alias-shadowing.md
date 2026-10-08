---
'@tanstack/db': minor
---

Allow a nested query to reuse an ancestor's source alias. References captured in the ancestor keep their original source, while callbacks in the nested query read its local source. Aliases must still be unique within one query scope and across branches of one `unionAll()`. Captured whole-row and nested-object spreads now follow the same binding rule.
