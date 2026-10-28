---
id: ConvexCollectionUtils
title: ConvexCollectionUtils
---

Defined in: [options.ts:15](https://github.com/tanstack/db/blob/main/packages/convex-db-collection/src/options.ts#L15)

## Extends

- `UtilsRecord`

## Indexable

```ts
[key: string]: any
```

## Properties

### awaitSync()

```ts
awaitSync: () => Promise<void>;
```

Defined in: [options.ts:19](https://github.com/tanstack/db/blob/main/packages/convex-db-collection/src/options.ts#L19)

Refresh the source cache and wait for sync acceptance, safe inside mutation handlers.

#### Returns

`Promise`\<`void`\>

***

### getSyncError()

```ts
getSyncError: () => unknown;
```

Defined in: [options.ts:17](https://github.com/tanstack/db/blob/main/packages/convex-db-collection/src/options.ts#L17)

Last subscription or conversion error, cleared by the next valid result.

#### Returns

`unknown`
