---
id: throttleStrategy
title: throttleStrategy
---

# Function: throttleStrategy()

```ts
function throttleStrategy(options): ThrottleStrategy;
```

Defined in: packages/db/src/strategies/throttleStrategy.ts:48

Creates a throttle strategy that ensures transactions are evenly spaced
over time.

Provides smooth, controlled execution patterns ideal for UI updates like
sliders, progress bars, or scroll handlers where you want consistent
execution timing.

## Parameters

### options

[`ThrottleStrategyOptions`](../../interfaces/ThrottleStrategyOptions.md)

Configuration for throttle behavior

## Returns

[`ThrottleStrategy`](../../interfaces/ThrottleStrategy.md)

A throttle strategy instance

## Examples

```ts
// Throttle slider updates to every 200ms
const mutate = usePacedMutations({
  onMutate: (volume) => {
    settingsCollection.update('volume', draft => { draft.value = volume })
  },
  mutationFn: async ({ transaction }) => {
    await api.updateVolume(transaction.mutations)
  },
  strategy: throttleStrategy({ wait: 200 })
})
```

```ts
// Throttle with leading and trailing execution
const mutate = usePacedMutations({
  onMutate: (data) => {
    collection.update(id, draft => { Object.assign(draft, data) })
  },
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: throttleStrategy({
    wait: 500,
    leading: true,
    trailing: true
  })
})
```
