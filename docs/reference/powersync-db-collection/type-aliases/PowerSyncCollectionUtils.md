---
id: PowerSyncCollectionUtils
title: PowerSyncCollectionUtils
---

```ts
type PowerSyncCollectionUtils<TTable> = object;
```

Defined in: [definitions.ts:321](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L321)

Collection-level utilities for PowerSync.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### getMeta()

```ts
getMeta: () => PowerSyncCollectionMeta<TTable>;
```

Defined in: [definitions.ts:322](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L322)

#### Returns

[`PowerSyncCollectionMeta`](PowerSyncCollectionMeta.md)\<`TTable`\>
