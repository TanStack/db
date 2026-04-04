---
id: ChangesPayload
title: ChangesPayload
---

# Type Alias: ChangesPayload\<T, TKey\>

```ts
type ChangesPayload<T, TKey> = ChangeMessage<WithVirtualProps<T, TKey>, TKey>[];
```

Defined in: [packages/db/src/types.ts:779](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L779)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
