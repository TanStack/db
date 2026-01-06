---
'@tanstack/db': patch
---

Export `ExtractContext` type to enable extracting query result types from Query instances.

```typescript
import { Query, ExtractContext, GetResult } from '@tanstack/db'

const myQuery = new Query()
  .from({ users })
  .select(({ users }) => ({ name: users.name }))

// Extract the result type:
type MyQueryResult = GetResult<ExtractContext<typeof myQuery>>
```
