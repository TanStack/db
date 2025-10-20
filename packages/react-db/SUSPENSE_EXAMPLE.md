# useLiveSuspenseQuery Example

## Basic Usage

```tsx
import { Suspense } from 'react';
import { useLiveSuspenseQuery } from '@tanstack/react-db';
import { todosCollection } from './collections';
import { eq } from '@tanstack/db';

function TodoList() {
  // Data is guaranteed to be defined - no loading states needed
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.completed, false))
  );

  return (
    <ul>
      {data.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}

function App() {
  return (
    <Suspense fallback={<div>Loading todos...</div>}>
      <TodoList />
    </Suspense>
  );
}
```

## With Error Boundary

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function App() {
  return (
    <ErrorBoundary fallback={<div>Failed to load todos</div>}>
      <Suspense fallback={<div>Loading todos...</div>}>
        <TodoList />
      </Suspense>
    </ErrorBoundary>
  );
}
```

## With Dependencies

```tsx
function FilteredTodoList({ filter }: { filter: string }) {
  const { data } = useLiveSuspenseQuery(
    (q) => q
      .from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.status, filter)),
    [filter]  // Re-suspends when filter changes
  );

  return (
    <ul>
      {data.map(todo => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

## Preventing Fallback During Updates

Use React's `startTransition` to prevent showing the fallback when dependencies change:

```tsx
import { useState, startTransition } from 'react';

function TodoApp() {
  const [filter, setFilter] = useState('all');

  const handleFilterChange = (newFilter: string) => {
    startTransition(() => {
      setFilter(newFilter);
    });
  };

  return (
    <div>
      <button onClick={() => handleFilterChange('all')}>All</button>
      <button onClick={() => handleFilterChange('active')}>Active</button>
      <button onClick={() => handleFilterChange('completed')}>Completed</button>

      <Suspense fallback={<div>Loading...</div>}>
        <FilteredTodoList filter={filter} />
      </Suspense>
    </div>
  );
}
```

## With TanStack Router

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { todosCollection } from './collections';

export const Route = createFileRoute('/todos')({
  // Preload in loader for instant navigation
  loader: async () => {
    await todosCollection.preload();
  },
  component: TodosPage,
});

function TodosPage() {
  // No suspend on first render if loader ran
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
  );

  return <TodoList todos={data} />;
}
```

## Single Result Query

```tsx
function TodoDetail({ id }: { id: string }) {
  const { data } = useLiveSuspenseQuery((q) =>
    q.from({ todos: todosCollection })
      .where(({ todos }) => eq(todos.id, id))
      .findOne()
  );

  // data is a single todo item (or undefined if not found)
  return data ? (
    <div>
      <h1>{data.text}</h1>
      <p>Status: {data.completed ? 'Done' : 'Pending'}</p>
    </div>
  ) : (
    <div>Todo not found</div>
  );
}
```

## Pre-created Collection

```tsx
import { createLiveQueryCollection } from '@tanstack/db';

const activeTodosQuery = createLiveQueryCollection((q) =>
  q.from({ todos: todosCollection })
    .where(({ todos }) => eq(todos.completed, false))
);

function ActiveTodos() {
  const { data } = useLiveSuspenseQuery(activeTodosQuery);
  return <TodoList todos={data} />;
}
```

## Key Differences from useLiveQuery

| Feature | useLiveQuery | useLiveSuspenseQuery |
|---------|--------------|---------------------|
| Loading State | Returns `isLoading`, `isError`, etc. | Handled by Suspense/Error boundaries |
| Data Type | `data: T \| undefined` | `data: T` (always defined) |
| Can be disabled | Yes (return `null`/`undefined`) | No - throws error |
| Error handling | Return `isError` flag | Throws to Error Boundary |
| Use case | Manual loading states | Declarative loading with Suspense |

## React Version Compatibility

`useLiveSuspenseQuery` works with **React 18+** using the throw promise pattern, the same approach as TanStack Query's `useSuspenseQuery`.
