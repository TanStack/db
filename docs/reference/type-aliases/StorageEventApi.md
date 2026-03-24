---
id: StorageEventApi
title: StorageEventApi
---

# Type Alias: StorageEventApi

```ts
type StorageEventApi = object;
```

Defined in: [packages/db/src/local-storage.ts:28](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L28)

Storage event API - subset of Window for 'storage' events only

## Properties

### addEventListener()

```ts
addEventListener: (type, listener) => void;
```

Defined in: [packages/db/src/local-storage.ts:29](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L29)

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

Defined in: [packages/db/src/local-storage.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts#L33)

#### Parameters

##### type

`"storage"`

##### listener

(`event`) => `void`

#### Returns

`void`
