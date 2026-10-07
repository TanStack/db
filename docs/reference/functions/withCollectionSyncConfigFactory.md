---
id: withCollectionSyncConfigFactory
title: withCollectionSyncConfigFactory
---

```ts
function withCollectionSyncConfigFactory<TSync>(sync, factory): CollectionSyncConfigWithFactory<TSync>;
```

Defined in: [packages/db/src/collection/index.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L79)

**`Internal`**

The factory must defer `startSyncIfIdle` until construction ends.

## Type Parameters

### TSync

`TSync` *extends* `object`

## Parameters

### sync

`TSync`

### factory

(`source`, `utilities`, `startSyncIfIdle`) => `TSync`

## Returns

`CollectionSyncConfigWithFactory`\<`TSync`\>
