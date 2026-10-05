---
id: SyncMetadataApi
title: SyncMetadataApi
---

Defined in: [packages/db/src/types.ts:492](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L492)

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### collection

```ts
collection: object;
```

Defined in: [packages/db/src/types.ts:500](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L500)

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

### persistence

```ts
persistence: 
  | SyncPersistenceCapabilityV1<TKey>
  | null;
```

Defined in: [packages/db/src/types.ts:518](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L518)

**`Internal`**

Unstable, versioned bridge between persistence-aware collection adapters
and sync adapters. Application code should not construct this capability.
Custom adapter wrappers must forward it unchanged. `null` explicitly means
that the collection has no persistence capability; a missing property is
invalid.

 Adapter infrastructure; not an application-facing API.

***

### row

```ts
row: object;
```

Defined in: [packages/db/src/types.ts:495](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L495)

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
