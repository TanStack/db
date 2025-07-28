# @tanstack/svelte-db

## 0.0.3

### Patch Changes

- Updated dependencies [[`6e8d7f6`](https://github.com/TanStack/db/commit/6e8d7f660050118e050d575913733e469e3daa8c)]:
  - @tanstack/db@0.0.33

## 0.0.2

### Patch Changes

- Updated dependencies [[`e04bd12`](https://github.com/TanStack/db/commit/e04bd1252f612d4638104368d17cb644cc85295b)]:
  - @tanstack/db@0.0.32

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
