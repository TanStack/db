---
id: trailBaseCollectionOptions
title: trailBaseCollectionOptions
---

```ts
function trailBaseCollectionOptions<TItem, TRecord, TKey>(config): CollectionConfig<TItem, TKey, never, TrailBaseCollectionUtils> & object;
```

Defined in: [packages/trailbase-db-collection/src/trailbase.ts:125](https://github.com/TanStack/db/blob/main/packages/trailbase-db-collection/src/trailbase.ts#L125)

## Type Parameters

### TItem

`TItem` *extends* `ShapeOf`\<`TRecord`\>

### TRecord

`TRecord` *extends* `ShapeOf`\<`TItem`\> = `TItem`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### config

[`TrailBaseCollectionConfig`](../interfaces/TrailBaseCollectionConfig.md)\<`TItem`, `TRecord`, `TKey`\>

## Returns

`CollectionConfig`\<`TItem`, `TKey`, `never`, [`TrailBaseCollectionUtils`](../interfaces/TrailBaseCollectionUtils.md)\> & `object`
