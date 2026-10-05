<div align="center">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://tanstack.com/api/readme/db.png?framework=react&theme=dark"
    />
    <source
      media="(prefers-color-scheme: light)"
      srcset="https://tanstack.com/api/readme/db.png?framework=react"
    />
    <img
      src="https://tanstack.com/api/readme/db.png?framework=react"
      alt="TanStack React DB"
      width="900"
    />
  </picture>
</div>
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
