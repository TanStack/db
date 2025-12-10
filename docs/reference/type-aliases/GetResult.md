---
id: GetResult
title: GetResult
---

# Type Alias: GetResult\<TContext\>

```ts
type GetResult<TContext> = Prettify<TContext["result"] extends object ? TContext["result"] : TContext["hasJoins"] extends true ? TContext["schema"] : TContext["schema"][TContext["fromSourceName"]]>;
```

Defined in: [packages/db/src/query/builder/types.ts:653](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L653)

GetResult - Determines the final result type of a query

This type implements the logic for what a query returns based on its current state:

**Priority Order**:
1. **Explicit Result**: If `select()` was called, use the projected type
2. **Join Query**: If joins exist, return all tables with proper optionality
3. **Single Table**: Return just the main table from `from()`

**Examples**:
```typescript
// Single table query:
from({ users }).where(...) // → User[]

// Join query without select:
from({ users }).leftJoin({ orders }, ...) // → { users: User, orders: Order | undefined }[]

// Query with select:
from({ users }).select({ id: users.id, name: users.name }) // → { id: number, name: string }[]
```

The `Prettify` wrapper ensures clean type display in IDEs by flattening
complex intersection types into readable object types.

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../../interfaces/Context.md)
