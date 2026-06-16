---
id: PowerSyncCollectionUtils
title: PowerSyncCollectionUtils
---

# Type Alias: PowerSyncCollectionUtils\<TTable\>

```ts
type PowerSyncCollectionUtils<TTable> = object;
```

Defined in: [definitions.ts:315](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L315)

Collection-level utilities for PowerSync.

## Type Parameters

### TTable

`TTable` *extends* `Table` = `Table`

## Properties

### getMeta()

```ts
getMeta: () => PowerSyncCollectionMeta<TTable>;
```

Defined in: [definitions.ts:316](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L316)

#### Returns

[`PowerSyncCollectionMeta`](PowerSyncCollectionMeta.md)\<`TTable`\>
