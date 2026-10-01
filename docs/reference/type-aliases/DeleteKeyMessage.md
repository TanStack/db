---
id: DeleteKeyMessage
title: DeleteKeyMessage
---

```ts
type DeleteKeyMessage<TKey> = Omit<ChangeMessage<any, TKey>, "value" | "previousValue" | "type"> & object;
```

Defined in: [packages/db/src/types.ts:567](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L567)

## Type Declaration

### type

```ts
type: "delete";
```

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`
