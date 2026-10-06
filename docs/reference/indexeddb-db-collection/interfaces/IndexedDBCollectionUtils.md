---
id: IndexedDBCollectionUtils
title: IndexedDBCollectionUtils
---

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:209](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L209)

Utility functions exposed on collection.utils

## Extends

- `UtilsRecord`

## Type Parameters

### TItem

`TItem` *extends* `object` = `Record`\<`string`, `unknown`\>

### TInsertInput

`TInsertInput` *extends* `object` = `TItem`

## Indexable

```ts
[key: string]: any
```

## Properties

### acceptMutations()

```ts
acceptMutations: (transaction) => Promise<void>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:227](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L227)

Accepts mutations from a manual transaction and persists to IndexedDB

#### Parameters

##### transaction

###### mutations

`PendingMutation`\<`Record`\<`string`, `unknown`\>, `OperationType`, `Collection`\<`Record`\<`string`, `unknown`\>, `any`, `any`, `any`, `any`\>\>[]

#### Returns

`Promise`\<`void`\>

***

### clearObjectStore()

```ts
clearObjectStore: () => Promise<void>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:217](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L217)

Removes all data from the object store
Does NOT delete the database itself

#### Returns

`Promise`\<`void`\>

***

### exportData()

```ts
exportData: () => Promise<TItem[]>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:235](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L235)

Exports all data from the object store as an array
Useful for backup/debugging

#### Returns

`Promise`\<`TItem`[]\>

***

### getDatabaseInfo()

```ts
getDatabaseInfo: () => Promise<DatabaseInfo>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:222](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L222)

Returns database information for debugging

#### Returns

`Promise`\<[`DatabaseInfo`](DatabaseInfo.md)\>

***

### importData()

```ts
importData: (items) => Promise<void>;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:241](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L241)

Validates input rows and atomically replaces the object store.
Failure preserves the previous rows and versions.

#### Parameters

##### items

`TInsertInput`[]

#### Returns

`Promise`\<`void`\>
