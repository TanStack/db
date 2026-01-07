---
'@tanstack/db': patch
---

Export `QueryResult` helper type for easily extracting query result types (similar to Zod's `z.infer`).

```typescript
import { Query, QueryResult } from '@tanstack/db'

const myQuery = new Query()
  .from({ users })
  .select(({ users }) => ({ name: users.name }))

// Extract the result type - clean and simple!
type MyQueryResult = QueryResult<typeof myQuery>
```

Also exports `ExtractContext` for advanced use cases where you need the full context type.
