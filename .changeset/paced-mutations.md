---
"@tanstack/db": patch
"@tanstack/react-db": patch
---

Add paced mutations with pluggable timing strategies

Introduces a new paced mutations system that enables optimistic mutations with pluggable timing strategies. This provides fine-grained control over when and how mutations are persisted to the backend. Powered by [TanStack Pacer](https://github.com/TanStack/pacer).

**Key Design:**

- **Debounce/Throttle**: Only one pending transaction (collecting mutations) and one persisting transaction (writing to backend) at a time. Multiple rapid mutations automatically merge together.
- **Queue**: Each mutation creates a separate transaction, guaranteed to run in the order they're made (FIFO by default, configurable to LIFO).

**Core Features:**

- **Pluggable Strategy System**: Choose from debounce, queue, or throttle strategies to control mutation timing
- **Auto-merging Mutations**: Multiple rapid mutations on the same item automatically merge for efficiency (debounce/throttle only)
- **Transaction Management**: Full transaction lifecycle tracking (pending → persisting → completed/failed)
- **React Hook**: `usePacedMutations` for easy integration in React applications

**Available Strategies:**

- `debounceStrategy`: Wait for inactivity before persisting. Only final state is saved. (ideal for auto-save, search-as-you-type)
- `queueStrategy`: Each mutation becomes a separate transaction, processed sequentially in order (defaults to FIFO, configurable to LIFO). All mutations are guaranteed to persist. (ideal for sequential workflows, rate-limited APIs)
- `throttleStrategy`: Ensure minimum spacing between executions. Mutations between executions are merged. (ideal for analytics, progress updates)

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
