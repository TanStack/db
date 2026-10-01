---
id: withCollectionSyncConfigFactory
title: withCollectionSyncConfigFactory
---

```ts
function withCollectionSyncConfigFactory<TSync>(sync, factory): CollectionSyncConfigWithFactory<TSync>;
```

Defined in: [packages/db/src/collection/index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L66)

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
