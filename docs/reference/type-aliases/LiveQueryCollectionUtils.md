---
id: LiveQueryCollectionUtils
title: LiveQueryCollectionUtils
---

# Type Alias: LiveQueryCollectionUtils

```ts
type LiveQueryCollectionUtils = UtilsRecord & object;
```

Defined in: packages/db/src/query/live/collection-config-builder.ts:39

## Type Declaration

### \[LIVE\_QUERY\_INTERNAL\]

```ts
[LIVE_QUERY_INTERNAL]: LiveQueryInternalUtils;
```

### getRunCount()

```ts
getRunCount: () => number;
```

#### Returns

`number`

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

### setWindow()

```ts
setWindow: (options) => true | Promise<void>;
```

Sets the offset and limit of an ordered query.
Is a no-op if the query is not ordered.

#### Parameters

##### options

`WindowOptions`

#### Returns

`true` \| `Promise`\<`void`\>

`true` if no subset loading was triggered, or `Promise<void>` that resolves when the subset has been loaded
