---
id: toArray
title: toArray
---

```ts
function toArray<TContext>(query): ToArrayWrapper<GetInlineResult<TContext>>;
```

Defined in: [packages/db/src/query/builder/include-functions.ts:15](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/include-functions.ts#L15)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### query

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

## Returns

`ToArrayWrapper`\<`GetInlineResult`\<`TContext`\>\>
