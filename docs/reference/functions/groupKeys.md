---
id: groupKeys
title: groupKeys
---

```ts
function groupKeys<TContext>(callback): GroupKeys<TContext>;
```

Defined in: [packages/db/src/query/builder/group-keys.ts:14](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/group-keys.ts#L14)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md) = `any`

## Parameters

### callback

[`OperatorCallback`](../type-aliases/OperatorCallback.md)\<`TContext`, [`GroupByCallback`](../type-aliases/GroupByCallback.md)\<`TContext`\>\>

## Returns

[`GroupKeys`](../interfaces/GroupKeys.md)\<`TContext`\>
