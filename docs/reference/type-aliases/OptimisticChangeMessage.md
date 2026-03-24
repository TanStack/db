---
id: OptimisticChangeMessage
title: OptimisticChangeMessage
---

# Type Alias: OptimisticChangeMessage\<T, TKey\>

```ts
type OptimisticChangeMessage<T, TKey> = 
  | ChangeMessage<T> & object
  | DeleteKeyMessage<TKey> & object;
```

Defined in: [packages/db/src/types.ts:380](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L380)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
