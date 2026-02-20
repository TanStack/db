---
id: usePacedMutations
title: usePacedMutations
---

# Function: usePacedMutations()

Creates a paced mutation function for optimistic updates.

## Example

```tsx
import { debounceStrategy, usePacedMutations } from '@tanstack/preact-db'

const mutate = usePacedMutations<string>({
  onMutate: (text) => {
    todosCollection.insert({ id: crypto.randomUUID(), text, completed: false })
  },
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 250 }),
})
```
