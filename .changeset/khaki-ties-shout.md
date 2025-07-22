---
"@tanstack/svelte-db": patch
---

Add Svelte support

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
