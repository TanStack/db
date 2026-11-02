---
id: ChangeMessageOrDeleteKeyMessage
title: ChangeMessageOrDeleteKeyMessage
---

```ts
type ChangeMessageOrDeleteKeyMessage<T, TKey> = 
  | Omit<ChangeMessage<T>, "key">
| DeleteKeyMessage<TKey>;
```

Defined in: [packages/db/src/types.ts:676](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L676)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
