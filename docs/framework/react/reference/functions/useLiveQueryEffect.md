---
id: useLiveQueryEffect
title: useLiveQueryEffect
---

# Function: useLiveQueryEffect()

```ts
function useLiveQueryEffect<TRow, TKey>(config, deps): void;
```

Defined in: [useLiveQueryEffect.ts:30](https://github.com/TanStack/db/blob/main/packages/react-db/src/useLiveQueryEffect.ts#L30)

React hook for creating a reactive effect that fires handlers when rows
enter, exit, or update within a query result.

The effect is created on mount and disposed on unmount. If `deps` change,
the previous effect is disposed and a new one is created.

## Type Parameters

### TRow

`TRow` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### config

`EffectConfig`\<`TRow`, `TKey`\>

### deps

`DependencyList` = `[]`

## Returns

`void`

## Example

```tsx
function ChatComponent() {
  useLiveQueryEffect(
    {
      query: (q) => q.from({ msg: messages }).where(({ msg }) => eq(msg.role, 'user')),
      skipInitial: true,
      onEnter: async (event) => {
        await generateResponse(event.value)
      },
    },
    []
  )

  return <div>...</div>
}
```
