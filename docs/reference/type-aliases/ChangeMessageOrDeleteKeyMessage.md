---
id: ChangeMessageOrDeleteKeyMessage
title: ChangeMessageOrDeleteKeyMessage
---

# Type Alias: ChangeMessageOrDeleteKeyMessage\<T, TKey\>

```ts
type ChangeMessageOrDeleteKeyMessage<T, TKey> = 
  | Omit<ChangeMessage<T>, "key">
| DeleteKeyMessage<TKey>;
```

Defined in: packages/db/src/types.ts:375

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
