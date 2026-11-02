---
id: convexCollectionOptions
title: convexCollectionOptions
---

```ts
function convexCollectionOptions<TQuery, TItem, TKey, TSchema>(config): CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & object & [TSchema] extends [never] ? unknown : object;
```

Defined in: [index.ts:48](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/index.ts#L48)

Mirror one authoritative Convex query result. Filters and joins run in DB.

## Type Parameters

### TQuery

`TQuery` *extends* `FunctionReference`\<`"query"`\>

### TItem

`TItem` *extends* `object` = `QueryRow`\<`TQuery`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`TItem`, `TItem`\> = `never`

## Parameters

### config

[`ConvexCollectionConfig`](../type-aliases/ConvexCollectionConfig.md)\<`TQuery`, `TItem`, `TKey`, `TSchema`\>

## Returns

`CollectionConfig`\<`TItem`, `TKey`, `TSchema`, [`ConvexCollectionUtils`](../interfaces/ConvexCollectionUtils.md)\> & `object` & \[`TSchema`\] *extends* \[`never`\] ? `unknown` : `object`
