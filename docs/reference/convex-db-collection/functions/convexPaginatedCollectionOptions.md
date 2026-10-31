---
id: convexPaginatedCollectionOptions
title: convexPaginatedCollectionOptions
---

```ts
function convexPaginatedCollectionOptions<TQuery, TItem, TKey, TSchema>(config): CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & object & [TSchema] extends [never] ? unknown : object;
```

Defined in: [paginated-options.ts:70](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L70)

Retain reactive cursor ranges; on-demand mode acquires only the prefix needed by active subsets.

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
