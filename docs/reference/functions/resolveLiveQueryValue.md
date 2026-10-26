---
id: resolveLiveQueryValue
title: resolveLiveQueryValue
---

```ts
function resolveLiveQueryValue(value, __namedParameters): 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | null;
```

Defined in: [packages/db/src/live-query-options.ts:318](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L318)

Resolve an adapter's query value to what its observer watches: `null` for a
disabled query, an existing Collection with sync started, or a live query.
A query builder whose shape a shared partition can serve gets a pooled view
instead of its own live-query Collection.

## Parameters

### value

`unknown`

### \_\_namedParameters

#### gcTime?

`number`

#### pool?

  \| `false`
  \| \{
  `createPooledLiveQuery`: (`query`, `__namedParameters`) => 
     \| [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
    \| `undefined`;
  `getPooledQueryIdentity`: (`query`) => `string` \| `undefined`;
\}

#### startSync?

`boolean` = `true`

## Returns

  \| [`Collection`](../interfaces/Collection.md)\<`any`, `any`, `any`, `StandardSchemaV1`\<`unknown`, `unknown`\>, `any`\>
  \| `null`
