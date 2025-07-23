# @tanstack/svelte-db

## 0.0.1

### Patch Changes

- Add Svelte support ([#91](https://github.com/TanStack/db/pull/91))

  Usage example:

  ```svelte
  <script lang="ts">
  import { useLiveQuery } from "@tanstack/svelte-db"
  import { eq } from "@tanstack/db"
  import { todoCollection } from "$lib/collections"

  const todosQuery = useLiveQuery((query) =>
    query
      .from({ todos: todoCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )
  </script>


  <List items={todosQuery.data} />
  ```

- Updated dependencies [[`3e9a36d`](https://github.com/TanStack/db/commit/3e9a36d2600c4f700ca7bc4f720c189a5a29387a)]:
  - @tanstack/db@0.0.31
