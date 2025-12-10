---
id: PowerSyncCollectionUtils
title: PowerSyncCollectionUtils
---

# Type Alias: PowerSyncCollectionUtils\<TTable\>

```ts
type PowerSyncCollectionUtils<TTable> = object;
```

Defined in: [definitions.ts:272](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L272)

Collection-level utilities for PowerSync.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### getMeta()

```ts
getMeta: () => PowerSyncCollectionMeta<TTable>;
```

Defined in: [definitions.ts:273](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L273)

#### Returns

[`PowerSyncCollectionMeta`](PowerSyncCollectionMeta.md)\<`TTable`\>
