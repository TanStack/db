---
id: withCollectionSyncConfigCleanup
title: withCollectionSyncConfigCleanup
---

```ts
function withCollectionSyncConfigCleanup<TSync>(sync, cleanup): TSync;
```

Defined in: [packages/db/src/collection/index.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/collection/index.ts#L81)

**`Internal`**

Registers work owned before an adapter sync starts.

## Type Parameters

### TSync

`TSync` *extends* `object`

## Parameters

### sync

`TSync`

### cleanup

() => `void`

## Returns

`TSync`
