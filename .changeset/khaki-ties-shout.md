---
"@tanstack/svelte-db": patch
---

Add Svelte support

Usage example:

```svelte
<script lang="ts">
import { useLiveQuery } from "@tanstack/svelte-db"
import { todoCollection } from "$lib/collections"

const query = useLiveQuery((query) =>
  query.from({ todoCollection }).where("@completed", "=", false)
)
</script>


<List items={query.data} />
```
