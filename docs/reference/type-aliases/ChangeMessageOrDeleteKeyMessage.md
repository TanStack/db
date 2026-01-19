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

Defined in: [packages/db/src/types.ts:370](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L370)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
