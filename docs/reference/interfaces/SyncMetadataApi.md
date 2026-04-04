---
id: SyncMetadataApi
title: SyncMetadataApi
---

# Interface: SyncMetadataApi\<TKey\>

Defined in: [packages/db/src/types.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L362)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### collection

```ts
collection: object;
```

Defined in: [packages/db/src/types.ts:370](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L370)

#### delete()

```ts
delete: (key) => void;
```

##### Parameters

###### key

`string`

##### Returns

`void`

#### get()

```ts
get: (key) => unknown;
```

##### Parameters

###### key

`string`

##### Returns

`unknown`

#### list()

```ts
list: (prefix?) => readonly object[];
```

##### Parameters

###### prefix?

`string`

##### Returns

readonly `object`[]

#### set()

```ts
set: (key, value) => void;
```

##### Parameters

###### key

`string`

###### value

`unknown`

##### Returns

`void`

***

### row

```ts
row: object;
```

Defined in: [packages/db/src/types.ts:365](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L365)

#### delete()

```ts
delete: (key) => void;
```

##### Parameters

###### key

`TKey`

##### Returns

`void`

#### get()

```ts
get: (key) => unknown;
```

##### Parameters

###### key

`TKey`

##### Returns

`unknown`

#### set()

```ts
set: (key, metadata) => void;
```

##### Parameters

###### key

`TKey`

###### metadata

`unknown`

##### Returns

`void`
