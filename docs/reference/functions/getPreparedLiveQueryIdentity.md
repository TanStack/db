---
id: getPreparedLiveQueryIdentity
title: getPreparedLiveQueryIdentity
---

```ts
function getPreparedLiveQueryIdentity(value, pool?): unknown;
```

Defined in: [packages/db/src/live-query-options.ts:250](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L250)

## Parameters

### value

`unknown`

### pool?

#### createPooledLiveQuery

(`query`, `__namedParameters`) => 
  \| [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
  \| `undefined`

#### getPooledQueryIdentity

(`query`) => `string` \| `undefined`

## Returns

`unknown`
