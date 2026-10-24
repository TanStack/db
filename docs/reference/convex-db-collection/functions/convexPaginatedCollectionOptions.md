---
id: convexPaginatedCollectionOptions
title: convexPaginatedCollectionOptions
---

```ts
function convexPaginatedCollectionOptions<TQuery, TItem, TKey, TSchema>(config): CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & object & [TSchema] extends [never] ? unknown : object;
```

Defined in: [paginated-options.ts:53](https://github.com/tanstack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L53)

Automatically subscribe to every page, retaining fixed reactive cursor ranges.

## Type Parameters

### TQuery

`TQuery` *extends* `FunctionReference`\<`"query"`\>

### TItem

`TItem` *extends* `object` = `PaginatedRow`\<`TQuery`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`TItem`, `TItem`\> = `never`

## Parameters

### config

[`ConvexPaginatedCollectionConfig`](../type-aliases/ConvexPaginatedCollectionConfig.md)\<`TQuery`, `TItem`, `TKey`, `TSchema`\>

## Returns

`CollectionConfig`\<`TItem`, `TKey`, `TSchema`, [`ConvexCollectionUtils`](../interfaces/ConvexCollectionUtils.md)\> & `object` & \[`TSchema`\] *extends* \[`never`\] ? `unknown` : `object`
