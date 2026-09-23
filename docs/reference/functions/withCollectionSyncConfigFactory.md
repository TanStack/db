---
id: withCollectionSyncConfigFactory
title: withCollectionSyncConfigFactory
---

```ts
function withCollectionSyncConfigFactory<TSync>(sync, factory): CollectionSyncConfigWithFactory<TSync>;
```

Defined in: [packages/db/src/collection/index.ts:66](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L66)

**`Internal`**

Lets adapters bind a sync config to each collection instance.

## Type Parameters

### TSync

`TSync` *extends* `object`

## Parameters

### sync

`TSync`

### factory

(`source`, `utilities`) => `TSync`

## Returns

`CollectionSyncConfigWithFactory`\<`TSync`\>
