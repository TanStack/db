---
id: ConvexPaginatedCollectionConfig
title: ConvexPaginatedCollectionConfig
---

```ts
type ConvexPaginatedCollectionConfig<TQuery, TItem, TKey, TSchema> = Omit<BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils, unknown>, "syncMode" | "utils" | "schema"> & object & [TSchema] extends [never] ? object : object & FunctionReturnType<TQuery> extends PaginationResult<object> ? unknown : never & FunctionArgs<TQuery> extends object ? unknown : never & 
  | {
  select: (rows) => ReadonlyArray<TItem>;
}
  | PaginatedRow<TQuery> extends TItem ? object : never;
```

Defined in: paginated-options.ts:20

## Type Declaration

### client

```ts
client: ConvexCollectionClient;
```

### onError()?

```ts
optional onError: (error) => void;
```

#### Parameters

##### error

`unknown`

#### Returns

`void`

### pageSize?

```ts
optional pageSize: number;
```

### query

```ts
query: TQuery;
```

### queryArgs

```ts
queryArgs: Omit<FunctionArgs<TQuery>, "paginationOpts">;
```

## Type Parameters

### TQuery

`TQuery` *extends* `FunctionReference`\<`"query"`\>

### TItem

`TItem` *extends* `object` = `PaginatedRow`\<`TQuery`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`TItem`, `TItem`\> = `never`
