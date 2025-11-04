---
"@tanstack/react-db": patch
---

Add `useLiveSuspenseQuery` hook for React Suspense support

Introduces a new `useLiveSuspenseQuery` hook that integrates with React Suspense and Error Boundaries, following TanStack Query's `useSuspenseQuery` pattern.

**Key features:**

- React 18+ compatible using the throw promise pattern
- Type-safe API with guaranteed data (never undefined)
- Automatic error handling via Error Boundaries
- Reactive updates after initial load via useSyncExternalStore
- Support for dependency-based re-suspension
- Works with query functions, config objects, and pre-created collections

**Example usage:**

```tsx
import { Suspense } from "react"
import { useLiveSuspenseQuery } from "@tanstack/react-db"

function TodoList() {
  // Data is guaranteed to be defined - no isLoading needed
  const { data } = useLiveSuspenseQuery((q) =>
    q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TodoList />
    </Suspense>
  )
}
```

**Implementation details:**

- Throws promises when collection is loading (caught by Suspense)
- Throws errors when collection fails (caught by Error Boundary)
- Reuses promise across re-renders to prevent infinite loops
- Detects dependency changes and creates new collection/promise
- Same TypeScript overloads as useLiveQuery for consistency

**Documentation:**

- Comprehensive guide in live-queries.md covering usage patterns and when to use each hook
- Comparison with useLiveQuery showing different approaches to loading/error states
- Router loader pattern recommendation for React Router/TanStack Router users
- Error handling examples with Suspense and Error Boundaries

Resolves #692
