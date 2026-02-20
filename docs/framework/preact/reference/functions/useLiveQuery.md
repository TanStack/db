---
id: useLiveQuery
title: useLiveQuery
---

# Function: useLiveQuery()

Creates a live query subscription for Preact components.

## Example

```tsx
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/preact-db'

function TodoList() {
  const { data, isLoading } = useLiveQuery((q) =>
    q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
      .select(({ todos }) => todos),
  )

  if (isLoading) return <div>Loading...</div>

  return <div>{data.length} open todos</div>
}
```
