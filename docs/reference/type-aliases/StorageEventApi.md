---
id: StorageEventApi
title: StorageEventApi
---

# Type Alias: StorageEventApi

```ts
type StorageEventApi = object;
```

Defined in: packages/db/src/local-storage.ts:28

Storage event API - subset of Window for 'storage' events only

## Properties

### addEventListener()

```ts
addEventListener: (type, listener) => void;
```

Defined in: packages/db/src/local-storage.ts:29

#### Parameters

##### type

`"storage"`

##### listener

(`event`) => `void`

#### Returns

`void`

***

### removeEventListener()

```ts
removeEventListener: (type, listener) => void;
```

Defined in: packages/db/src/local-storage.ts:33

#### Parameters

##### type

`"storage"`

##### listener

(`event`) => `void`

#### Returns

`void`
