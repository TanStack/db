---
id: IndexedDBCollectionUtils
title: IndexedDBCollectionUtils
---

Defined in: packages/db/src/indexed-db.ts:206

Utility functions exposed on collection.utils

## Extends

- [`UtilsRecord`](../type-aliases/UtilsRecord.md)

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

Defined in: packages/db/src/indexed-db.ts:224

Accepts mutations from a manual transaction and persists to IndexedDB

#### Parameters

##### transaction

###### mutations

[`PendingMutation`](PendingMutation.md)\<`Record`\<`string`, `unknown`\>, [`OperationType`](../type-aliases/OperationType.md), [`Collection`](Collection.md)\<`Record`\<`string`, `unknown`\>, `any`, `any`, `any`, `any`\>\>[]

#### Returns

`Promise`\<`void`\>

***

### clearObjectStore()

```ts
clearObjectStore: () => Promise<void>;
```

Defined in: packages/db/src/indexed-db.ts:214

Removes all data from the object store
Does NOT delete the database itself

#### Returns

`Promise`\<`void`\>

***

### exportData()

```ts
exportData: () => Promise<TItem[]>;
```

Defined in: packages/db/src/indexed-db.ts:232

Exports all data from the object store as an array
Useful for backup/debugging

#### Returns

`Promise`\<`TItem`[]\>

***

### getDatabaseInfo()

```ts
getDatabaseInfo: () => Promise<DatabaseInfo>;
```

Defined in: packages/db/src/indexed-db.ts:219

Returns database information for debugging

#### Returns

`Promise`\<[`DatabaseInfo`](DatabaseInfo.md)\>

***

### importData()

```ts
importData: (items) => Promise<void>;
```

Defined in: packages/db/src/indexed-db.ts:238

Validates input rows and atomically replaces the object store.
Failure preserves the previous rows and versions.

#### Parameters

##### items

`TInsertInput`[]

#### Returns

`Promise`\<`void`\>
