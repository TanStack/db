---
id: groupKeys
title: groupKeys
---

```ts
function groupKeys<TContext, TKeys>(callback): GroupKeys<TContext, TKeys>;
```

Defined in: [packages/db/src/query/builder/group-keys.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/group-keys.ts#L14)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = `any`

### TKeys

`TKeys` = `any`

## Parameters

### callback

(`refs`) => `TKeys`

## Returns

[`GroupKeys`](../interfaces/GroupKeys.md)\<`TContext`, `TKeys`\>
