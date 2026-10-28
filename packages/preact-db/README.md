# @tanstack/preact-db

Preact hooks for TanStack DB. See [TanStack/db](https://github.com/TanStack/db) for more details.

## Installation

```sh
npm install @tanstack/preact-db
```

`@tanstack/preact-db` supports Preact 10 and later and ships as ES modules.

Queries read concrete source Collections. Preact has no `DbProvider` yet, so it does not bind collection descriptors or read from a `DbClient`; a query over a descriptor throws when it is consumed. Use `@tanstack/react-db` or `@tanstack/svelte-db` for `DbClient`-based SSR and hydration.

## Usage

```tsx
import { eq, useLiveQuery } from '@tanstack/preact-db'

function TodoList({ userId }: { userId?: string }) {
  const { data, isLoading } = useLiveQuery((q) =>
    userId
      ? q
          .from({ todos: todosCollection })
          .where(({ todos }) => eq(todos.userId, userId))
      : undefined,
  )

  if (isLoading) return <div>Loading...</div>
  return (
    <ul>
      {data?.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

`useLiveQuery` accepts a query callback, a `{ query }` config object, or an
existing live-query Collection. Return `undefined` or `null` from the callback
to disable the query. `useLiveInfiniteQuery` pages an ordered live query.

The hooks derive each query's identity from its structured IR, so values the
callback captures recompile the query when they change. A query that uses
functional variants such as `fn.where` has no stable IR hash and throws
`UnhashableQueryIRError` unless a config object names it with `queryKey`:

```ts
const { data } = useLiveQuery({
  queryKey: [`todos-by-text`, search],
  query: (q) =>
    q
      .from({ todos: todosCollection })
      .fn.where(({ todos }) => todos.text.includes(search)),
})
```

See the [Preact adapter documentation](https://tanstack.com/db/latest/docs/framework/preact/overview) for more.
