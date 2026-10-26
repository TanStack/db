---
id: getPreparedLiveQuerySources
title: getPreparedLiveQuerySources
---

```ts
function getPreparedLiveQuerySources(value, onUnboundDescriptor?): Collection<Record<string, unknown>, string | number, UtilsRecord, StandardSchemaV1<unknown, unknown>, Record<string, unknown>>[];
```

Defined in: [packages/db/src/live-query-options.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-options.ts#L227)

Concrete source objects in query-position order for a prepared value.

## Parameters

### value

`unknown`

### onUnboundDescriptor?

(`alias`) => `never`

## Returns

[`Collection`](../interfaces/Collection.md)\<`Record`\<`string`, `unknown`\>, `string` \| `number`, [`UtilsRecord`](../type-aliases/UtilsRecord.md), `StandardSchemaV1`\<`unknown`, `unknown`\>, `Record`\<`string`, `unknown`\>\>[]
