---
'@tanstack/db': minor
---

Add `dependencyQueueStrategy` for parallel execution of independent mutations.

This new paced mutations strategy enables mutations on different records to run in parallel while still serializing mutations that share dependencies (based on `globalKey`). This provides better performance than `queueStrategy` when mutations are independent, without sacrificing correctness.

Key features:
- Mutations on different records run concurrently
- Mutations on the same record are serialized in order
- Supports custom dependency declarations via `getDependencies` callback for semantic relationships

```ts
import { dependencyQueueStrategy } from '@tanstack/db'

const mutate = usePacedMutations({
  onMutate: (vars) => collection.update(vars.id, ...),
  mutationFn: async ({ transaction }) => api.save(transaction.mutations),
  strategy: dependencyQueueStrategy()
})

// These run in parallel (different records):
mutate({ id: 1, title: 'A' })
mutate({ id: 2, title: 'B' })

// This waits for the first one (same record):
mutate({ id: 1, title: 'C' })
```
