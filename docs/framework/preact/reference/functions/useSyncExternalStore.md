---
id: useSyncExternalStore
title: useSyncExternalStore
---

# Function: useSyncExternalStore()

Lightweight `useSyncExternalStore` implementation for Preact hooks without importing `preact/compat`.

## Example

```tsx
import { useSyncExternalStore } from '@tanstack/preact-db'

function Counter({ store }: { store: { subscribe: (fn: () => void) => () => void; getSnapshot: () => number } }) {
  const count = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return <span>{count}</span>
}
```
