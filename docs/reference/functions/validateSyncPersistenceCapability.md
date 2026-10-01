---
id: validateSyncPersistenceCapability
title: validateSyncPersistenceCapability
---

```ts
function validateSyncPersistenceCapability<TKey>(value): 
  | SyncPersistenceCapabilityV1<TKey>
  | null;
```

Defined in: [packages/db/src/sync-persistence.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/sync-persistence.ts#L38)

**`Internal`**

Validates the cross-package structural persistence protocol before a sync
adapter uses it. Null explicitly means that the collection has no
persistence capability; undefined means a wrapper dropped the required
field. Any advertised capability must be complete.

 This is adapter infrastructure, not an application API.

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Parameters

### value

`unknown`

## Returns

  \| [`SyncPersistenceCapabilityV1`](../type-aliases/SyncPersistenceCapabilityV1.md)\<`TKey`\>
  \| `null`
