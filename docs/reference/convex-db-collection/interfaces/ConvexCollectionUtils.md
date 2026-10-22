---
id: ConvexCollectionUtils
title: ConvexCollectionUtils
---

Defined in: options.ts:11

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

Defined in: options.ts:15

Refresh the source cache and wait for sync acceptance, safe inside mutation handlers.

#### Returns

`Promise`\<`void`\>

***

### getSyncError()

```ts
getSyncError: () => unknown;
```

Defined in: options.ts:13

Last subscription or conversion error, cleared by the next valid result.

#### Returns

`unknown`
