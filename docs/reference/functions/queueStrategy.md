---
id: queueStrategy
title: queueStrategy
---

```ts
function queueStrategy(options?): QueueStrategy;
```

Defined in: [packages/db/src/strategies/queueStrategy.ts:56](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/queueStrategy.ts#L56)

Creates a queue strategy that processes admitted mutations in order with proper serialization.

Unlike other strategies that may drop executions, queue ensures every
admitted mutation is attempted sequentially. Each transaction commit completes before
the next one starts. Useful when data consistency is critical and
every admitted operation must be attempted in order. When a bounded queue is
full, the returned transaction fails and its optimistic mutation rolls back.
Cleanup stops new admission. The existing timer drains admitted waiting work
at its configured pace behind earlier writes. Cleanup does not wait for settlement.

**Error handling behavior:**
- If a mutation fails, it is NOT automatically retried - the transaction transitions to "failed" state
- Failed mutations surface their error via `transaction.isPersisted.promise` (which will reject)
- Subsequent mutations continue processing - a single failure does not block the queue
- Each mutation is independent; there is no all-or-nothing transaction semantics

## Parameters

### options?

[`QueueStrategyOptions`](../interfaces/QueueStrategyOptions.md)

Configuration for queue behavior (FIFO/LIFO, timing, size limits)

## Returns

[`QueueStrategy`](../interfaces/QueueStrategy.md)

A queue strategy instance

## Examples

```ts
// FIFO queue - process in order received
const mutate = usePacedMutations({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: queueStrategy({
    wait: 200,
    addItemsTo: 'back',
    getItemsFrom: 'front'
  })
})
```

```ts
// LIFO queue - process most recent first
const mutate = usePacedMutations({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: queueStrategy({
    wait: 200,
    addItemsTo: 'back',
    getItemsFrom: 'back'
  })
})
```
