---
id: DeleteKeyMessage
title: DeleteKeyMessage
---

# Type Alias: DeleteKeyMessage\<TKey\>

```ts
type DeleteKeyMessage<TKey> = Omit<ChangeMessage<any, TKey>, "value" | "previousValue" | "type"> & object;
```

Defined in: [packages/db/src/types.ts:461](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L461)

## Type Declaration

### type

```ts
type: "delete";
```

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
