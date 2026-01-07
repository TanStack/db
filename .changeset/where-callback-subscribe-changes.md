---
'@tanstack/db': patch
---

Add `where` callback option to `subscribeChanges` for ergonomic filtering

Instead of manually constructing IR with `PropRef`:

```ts
import { eq, PropRef } from '@tanstack/db'
collection.subscribeChanges(callback, {
  whereExpression: eq(new PropRef(['status']), 'active'),
})
```

You can now use a callback with query builder functions:

```ts
import { eq } from '@tanstack/db'
collection.subscribeChanges(callback, {
  where: (row) => eq(row.status, 'active'),
})
```
