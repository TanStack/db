---
id: StorageEventApi
title: StorageEventApi
---

```ts
type StorageEventApi = object;
```

Defined in: [packages/db/src/local-storage.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L35)

Storage event API - subset of Window for 'storage' events only

## Properties

### addEventListener()

```ts
addEventListener: (type, listener) => void;
```

Defined in: [packages/db/src/local-storage.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L36)

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

Defined in: [packages/db/src/local-storage.ts:40](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L40)

#### Parameters

##### type

`"storage"`

##### listener

(`event`) => `void`

#### Returns

`void`
