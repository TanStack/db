---
id: CollectionConfigSingleRowOption
title: CollectionConfigSingleRowOption
---

# Type Alias: CollectionConfigSingleRowOption\<T, TKey, TSchema, TUtils\>

```ts
type CollectionConfigSingleRowOption<T, TKey, TSchema, TUtils> = CollectionConfig<T, TKey, TSchema, TUtils> & MaybeSingleResult;
```

Defined in: [packages/db/src/types.ts:613](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L613)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

### TUtils

`TUtils` *extends* [`UtilsRecord`](../UtilsRecord.md) = \{
\}
