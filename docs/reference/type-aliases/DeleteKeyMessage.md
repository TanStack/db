---
id: DeleteKeyMessage
title: DeleteKeyMessage
---

```ts
type DeleteKeyMessage<TKey> = Omit<ChangeMessage<any, TKey>, "value" | "previousValue" | "type"> & object;
```

Defined in: [packages/db/src/types.ts:611](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L611)

## Type Declaration

### type

```ts
type: "delete";
```

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
