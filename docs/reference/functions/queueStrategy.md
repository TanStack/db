---
id: queueStrategy
title: queueStrategy
---

# Function: queueStrategy()

```ts
function queueStrategy(options?): QueueStrategy;
```

Defined in: packages/db/src/strategies/queueStrategy.ts:46

Creates a queue strategy that processes all mutations in order with proper serialization.

Unlike other strategies that may drop executions, queue ensures every
mutation is processed sequentially. Each transaction commit completes before
the next one starts. Useful when data consistency is critical and
every operation must complete in order.

## Parameters

### options?

[`QueueStrategyOptions`](../../interfaces/QueueStrategyOptions.md)

Configuration for queue behavior (FIFO/LIFO, timing, size limits)

## Returns

[`QueueStrategy`](../../interfaces/QueueStrategy.md)

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
