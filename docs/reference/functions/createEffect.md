---
id: createEffect
title: createEffect
---

```ts
function createEffect<TRow, TKey>(config): Effect;
```

Defined in: [packages/db/src/query/effect.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/query/effect.ts#L227)

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
