---
id: LiveQueryCollectionUtils
title: LiveQueryCollectionUtils
---

```ts
type LiveQueryCollectionUtils = UtilsRecord & object;
```

Defined in: [packages/db/src/query/live/collection-config-builder.ts:58](https://github.com/TanStack/db/blob/main/packages/db/src/query/live/collection-config-builder.ts#L58)

## Type Declaration

### \[LIVE\_QUERY\_INTERNAL\]

```ts
[LIVE_QUERY_INTERNAL]: LiveQueryInternalUtils;
```

### getWindow()

```ts
getWindow: () => 
  | {
  limit: number;
  offset: number;
}
  | undefined;
```

Gets the current window (offset and limit) for an ordered query.

#### Returns

  \| \{
  `limit`: `number`;
  `offset`: `number`;
\}
  \| `undefined`

The current window settings, or `undefined` if the query is not windowed

### lastSubsetError

```ts
readonly lastSubsetError: unknown | undefined;
```

Most recent subset-load failure observed by this live query.

### setWindow()

```ts
setWindow: (options) => true | Promise<void>;
```

Sets the offset and limit of the query's window. A query has a window
when it has an `orderBy` or is a `findOne`. A `findOne` keeps its compiled
limit (1, or 0 for `.limit(0).findOne()`), and only an ordered `findOne`
can move its offset.

#### Parameters

##### options

`WindowOptions`

#### Returns

`true` \| `Promise`\<`void`\>

`true` if no subset loading was triggered, or `Promise<void>` that resolves when the subset has been loaded

#### Throws

`SetWindowRequiresOrderByError` if the query has no window, or an
unordered `findOne` would move its offset.

#### Throws

`SetWindowFindOneLimitError` if a `findOne` would change its limit.
