---
id: ConvexPaginatedCollectionConfig
title: ConvexPaginatedCollectionConfig
---

```ts
type ConvexPaginatedCollectionConfig<TQuery, TItem, TKey, TSchema> = Omit<BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils>, "syncMode" | "utils" | "schema"> & object & [TSchema] extends [never] ? object : object & FunctionReturnType<TQuery> extends PaginationResult<object> ? unknown : never & FunctionArgs<TQuery> extends object ? unknown : never & 
  | object & 
  | {
  select: (rows) => ReadonlyArray<TItem>;
}
  | PaginatedRow<TQuery> extends TItem ? object : never
  | object & PaginatedRow<TQuery> extends TItem ? unknown : never;
```

Defined in: [paginated-options.ts:30](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/paginated-options.ts#L30)

## Type Declaration

### client

```ts
client: ConvexCollectionClient;
```

### maxRows?

```ts
optional maxRows: number;
```

Maximum accepted rows in the retained query prefix. Defaults to 10,000.

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
