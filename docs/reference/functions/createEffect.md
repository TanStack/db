---
id: createEffect
title: createEffect
---

# Function: createEffect()

```ts
function createEffect<TRow, TKey>(config): Effect;
```

Defined in: [packages/db/src/query/effect.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L184)

Creates a reactive effect that fires handlers when rows enter, exit, or
update within a query result. Effects process deltas only — they do not
maintain or require the full materialised query result.

## Type Parameters

### TRow

`TRow` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### config

[`EffectConfig`](../interfaces/EffectConfig.md)\<`TRow`, `TKey`\>

## Returns

[`Effect`](../interfaces/Effect.md)

## Example

```typescript
const effect = createEffect({
  query: (q) => q.from({ msg: messagesCollection })
    .where(({ msg }) => eq(msg.role, 'user')),
  onEnter: async (event) => {
    await generateResponse(event.value)
  },
})

// Later: stop the effect
await effect.dispose()
```
