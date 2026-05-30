# @tanstack/react-db

React hooks for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodoList() {
  const { data: todos } = useLiveQuery({
    query: (q) => q.from({ todo: todoCollection }),
  })

  return todos.map((todo) => <div key={todo.id}>{todo.text}</div>)
}
```
