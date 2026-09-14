---
id: CollectionOptions
title: CollectionOptions
---

# Type Alias: CollectionOptions\<T, TKey, TSchema, TUtils\>

```ts
type CollectionOptions<T, TKey, TSchema, TUtils> = CollectionOptionsIdentity<T, TKey, TSchema, TUtils, DbClient>;
```

Defined in: [packages/db/src/client.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L39)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

### TUtils

`TUtils` *extends* [`UtilsRecord`](UtilsRecord.md) = [`UtilsRecord`](UtilsRecord.md)
