---
id: configPool
title: configPool
---

```ts
function configPool(config): 
  | {
  createPooledLiveQuery: (query, __namedParameters) => 
     | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
    | undefined;
  getPooledQueryIdentity: (query) => string | undefined;
}
  | undefined;
```

Defined in: [packages/db/src/live-query-options.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L34)

A hook config's pool: `pooledLiveQueries` or nothing. Any other value, such
as the removed boolean form, contradicts the hook contract, so every reader
rejects it the same way, whatever the config's other options. An adapter
that reads the pool from its own options, as Angular does, checks it here.

## Parameters

### config

`object`

## Returns

```ts
{
  createPooledLiveQuery: (query, __namedParameters) => 
     | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
    | undefined;
  getPooledQueryIdentity: (query) => string | undefined;
}
```

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

`undefined`
