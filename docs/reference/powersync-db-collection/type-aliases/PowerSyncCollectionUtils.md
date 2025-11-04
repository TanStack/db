---
id: PowerSyncCollectionUtils
title: PowerSyncCollectionUtils
---

# Type Alias: PowerSyncCollectionUtils\<TTable\>

```ts
type PowerSyncCollectionUtils<TTable> = object;
```

Defined in: [definitions.ts:267](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L267)

Collection-level utilities for PowerSync.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### getMeta()

```ts
getMeta: () => PowerSyncCollectionMeta<TTable>;
```

Defined in: [definitions.ts:268](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/definitions.ts#L268)

#### Returns

[`PowerSyncCollectionMeta`](PowerSyncCollectionMeta.md)\<`TTable`\>
