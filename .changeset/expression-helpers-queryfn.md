---
"@tanstack/query-db-collection": patch
---

Add expression helper utilities for parsing LoadSubsetOptions in queryFn.

When using `syncMode: 'on-demand'`, query collections now provide helper functions to easily parse where clauses, orderBy, and limit predicates into your API's format:

- `parseWhereExpression`: Parse where clauses with custom handlers for each operator
- `parseOrderByExpression`: Parse order by into simple array format
- `extractSimpleComparisons`: Extract simple AND-ed filters
- `parseLoadSubsetOptions`: Convenience function to parse all options at once
- `walkExpression`, `extractFieldPath`, `extractValue`: Lower-level helpers

**Example:**

```typescript
import { parseLoadSubsetOptions } from "@tanstack/query-db-collection"

queryFn: async (ctx) => {
  const { where, orderBy, limit } = ctx.meta.loadSubsetOptions

  const parsed = parseLoadSubsetOptions({ where, orderBy, limit })

  // Build API request from parsed filters
  const params = new URLSearchParams()
  parsed.filters.forEach(({ field, operator, value }) => {
    if (operator === "eq") {
      params.set(field.join("."), String(value))
    }
  })

  return fetch(`/api/products?${params}`).then((r) => r.json())
}
```

This eliminates the need to manually traverse expression AST trees when implementing predicate push-down.
