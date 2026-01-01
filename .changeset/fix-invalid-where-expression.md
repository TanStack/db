---
'@tanstack/db': patch
---

Add validation for where() and having() expressions to catch JavaScript operator usage

When users accidentally use JavaScript's comparison operators (`===`, `!==`, `<`, `>`, etc.) in `where()` or `having()` callbacks instead of query builder functions (`eq`, `gt`, etc.), the query builder now throws a helpful `InvalidWhereExpressionError` with clear guidance.

Previously, this mistake would result in a confusing "Unknown expression type: undefined" error at query compilation time. Now users get immediate feedback with an example of the correct syntax:

```
❌ .where(({ user }) => user.id === 'abc')
✅ .where(({ user }) => eq(user.id, 'abc'))
```
