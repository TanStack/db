---
id: ConvexCollectionConfig
title: ConvexCollectionConfig
---

```ts
type ConvexCollectionConfig<TQuery, TItem, TKey, TSchema> = Omit<BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils>, "syncMode" | "utils" | "schema"> & object & [TSchema] extends [never] ? object : object & 
  | {
  select: (result) => ReadonlyArray<TItem>;
}
  | FunctionReturnType<TQuery> extends ReadonlyArray<TItem> ? object : never;
```

Defined in: [index.ts:21](https://github.com/TanStack/db/blob/main/packages/convex-db-collection/src/index.ts#L21)

## Type Declaration

### client

```ts
client: ConvexCollectionClient;
```

Share the client used for mutations, authentication, and reconnects.

### onError()?

```ts
optional onError: (error) => void;
```

Reports subscription and result-conversion failures, including after readiness.

#### Parameters

##### error

`unknown`

#### Returns

`void`

### query

```ts
query: TQuery;
```

### queryArgs

```ts
queryArgs: FunctionArgs<TQuery>;
```

## Type Parameters

### TQuery

`TQuery` *extends* `FunctionReference`\<`"query"`\>

### TItem

`TItem` *extends* `object` = `QueryRow`\<`TQuery`\>

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

### TSchema

`TSchema` *extends* `StandardSchemaV1`\<`TItem`, `TItem`\> = `never`
