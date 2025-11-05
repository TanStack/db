---
id: debounceStrategy
title: debounceStrategy
---

# Function: debounceStrategy()

```ts
function debounceStrategy(options): DebounceStrategy;
```

Defined in: [packages/db/src/strategies/debounceStrategy.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/strategies/debounceStrategy.ts#L25)

Creates a debounce strategy that delays transaction execution until after
a period of inactivity.

Ideal for scenarios like search inputs or auto-save fields where you want
to wait for the user to stop typing before persisting changes.

## Parameters

### options

[`DebounceStrategyOptions`](../../interfaces/DebounceStrategyOptions.md)

Configuration for the debounce behavior

## Returns

[`DebounceStrategy`](../../interfaces/DebounceStrategy.md)

A debounce strategy instance

## Example

```ts
const mutate = useSerializedTransaction({
  mutationFn: async ({ transaction }) => {
    await api.save(transaction.mutations)
  },
  strategy: debounceStrategy({ wait: 500 })
})
```
