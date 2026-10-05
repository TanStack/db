---
'@tanstack/db': minor
---

Add compound joins with nested `and()` equality conditions, preserving existing
value matching, lazy loading, and correlated include behavior. The low-level
`JoinClause` IR now stores the complete predicate in `on`; code that constructs
IR directly must replace `left` and `right` with
`on: new Func('eq', [left, right])` for a single equality.
