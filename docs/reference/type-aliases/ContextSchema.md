---
id: ContextSchema
title: ContextSchema
---

# Type Alias: ContextSchema

```ts
type ContextSchema = Record<string, unknown>;
```

Defined in: packages/db/src/query/builder/types.ts:64

ContextSchema - The shape of available tables/collections in a query context

This is simply a record mapping table aliases to their TypeScript types.
It evolves as the query progresses:
- Initial: Just the `from()` table
- After joins: Includes all joined tables with proper optionality
- In subqueries: May be a subset of the outer query's schema
