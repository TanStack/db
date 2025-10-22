---
"@tanstack/db": minor
"@tanstack/react-db": minor
---

Add paced mutations with pluggable timing strategies

Introduces a new paced mutations system that enables optimistic mutations with pluggable timing strategies. This provides fine-grained control over when and how mutations are persisted to the backend.

**Core Features:**

- **Pluggable Strategy System**: Choose from debounce, queue, or throttle strategies to control mutation timing
- **Auto-merging Mutations**: Multiple rapid mutations on the same item automatically merge for efficiency
- **Transaction Management**: Full transaction lifecycle tracking (pending → persisting → completed/failed)
- **React Hook**: `usePacedMutations` for easy integration in React applications

**Available Strategies:**

- `debounceStrategy`: Wait for inactivity before persisting (ideal for auto-save, search-as-you-type)
- `queueStrategy`: Process each mutation as a separate transaction sequentially (defaults to FIFO, configurable to LIFO) (ideal for sequential workflows, rate-limited APIs)
- `throttleStrategy`: Ensure minimum spacing between executions (ideal for analytics, progress updates)

**Example Usage:**

```ts
import { usePacedMutations, debounceStrategy } from "@tanstack/react-db"

const mutate = usePacedMutations({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 }),
})

// Trigger a mutation
const tx = mutate(() => {
  collection.update(id, (draft) => {
    draft.value = newValue
  })
})

// Optionally await persistence
await tx.isPersisted.promise
```
