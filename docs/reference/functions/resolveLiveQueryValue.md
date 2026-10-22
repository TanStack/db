---
id: resolveLiveQueryValue
title: resolveLiveQueryValue
---

```ts
function resolveLiveQueryValue(value, __namedParameters): 
  | Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>
  | null;
```

Defined in: [packages/db/src/live-query-options.ts:232](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L232)

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
