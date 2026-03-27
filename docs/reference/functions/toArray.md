---
id: toArray
title: toArray
---

# Function: toArray()

```ts
function toArray<TContext>(query): ToArrayWrapper<GetRawResult<TContext>>;
```

Defined in: [packages/db/src/query/builder/functions.ts:451](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/functions.ts#L451)

## Type Parameters

### TContext

`TContext` *extends* [`Context`](../interfaces/Context.md)

## Parameters

### query

[`QueryBuilder`](../type-aliases/QueryBuilder.md)\<`TContext`\>

## Returns

`ToArrayWrapper`\<`GetRawResult`\<`TContext`\>\>
