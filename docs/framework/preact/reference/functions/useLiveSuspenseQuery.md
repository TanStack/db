---
id: useLiveSuspenseQuery
title: useLiveSuspenseQuery
---

# Function: useLiveSuspenseQuery()

Creates a live query that integrates with Suspense.

## Example

```tsx
import { Suspense } from 'preact/compat'
import { useLiveSuspenseQuery } from '@tanstack/preact-db'

function Todos() {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection }).select(({ todos }) => todos),
  )

  return <div>{data.length}</div>
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Todos />
    </Suspense>
  )
}
```
