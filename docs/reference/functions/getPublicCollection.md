---
id: getPublicCollection
title: getPublicCollection
---

```ts
function getPublicCollection<T>(collection): T;
```

Defined in: [packages/db/src/live-query-adapter.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L38)

The Collection an adapter hands users as `collection`. A pooled live query
stands in for its live-query Collection and builds it only when touched.

## Type Parameters

### T

`T` *extends* 
  \| [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
  \| `null`
  \| `undefined`

## Parameters

### collection

`T`

## Returns

`T`
