---
id: pooledLiveQueries
title: pooledLiveQueries
---

```ts
const pooledLiveQueries: object;
```

Defined in: [packages/db/src/query/pooled-live-query.ts:728](https://github.com/TanStack/db/blob/main/packages/db/src/query/pooled-live-query.ts#L728)

Pooled live queries for framework hooks. Pass it as `pool` in a hook's
query config to serve equality-filtered queries of one shape from a shared
partition. Apps that do not pass it do not bundle pooling.

## Type Declaration

### createPooledLiveQuery()

```ts
createPooledLiveQuery: (query, __namedParameters) => 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | undefined;
```

A pooled view for a query a partition can serve, or undefined. The view is
typed as the Collection it stands in for.

#### Parameters

##### query

[`BaseQueryBuilder`](../classes/BaseQueryBuilder.md)

##### \_\_namedParameters

###### gcTime?

`number` = `5_000`

#### Returns

  \| [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
  \| `undefined`

### getPooledQueryIdentity()

```ts
getPooledQueryIdentity: (query) => string | undefined;
```

The identity of a query a partition can serve with no residual conjunct:
its source and its `eq` fields and literals, which determine its rows.
Undefined for any other query, which keeps the full structural identity.

#### Parameters

##### query

[`BaseQueryBuilder`](../classes/BaseQueryBuilder.md)

#### Returns

`string` \| `undefined`
