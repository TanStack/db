---
id: IndexedDBCollectionUtils
title: IndexedDBCollectionUtils
---

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:193](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L193)

Utility functions exposed on collection.utils

## Extends

- `UtilsRecord`

## Type Parameters

### TItem

`TItem` *extends* `object` = `Record`\<`string`, `unknown`\>

### _TKey

`_TKey` *extends* `string` \| `number` = `string` \| `number`

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

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:218](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L218)

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

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:202](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L202)

Removes all data from the object store
Does NOT delete the database itself

#### Returns

`Promise`\<`void`\>

***

### deleteDatabase()

```ts
deleteDatabase: () => Promise<void>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:208](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L208)

Deletes the entire database
Use with caution - removes all object stores and indexes

#### Returns

`Promise`\<`void`\>

***

### exportData()

```ts
exportData: () => Promise<TItem[]>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:226](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L226)

Exports all data from the object store as an array
Useful for backup/debugging

#### Returns

`Promise`\<`TItem`[]\>

***

### getDatabaseInfo()

```ts
getDatabaseInfo: () => Promise<DatabaseInfo>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:213](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L213)

Returns database information for debugging

#### Returns

`Promise`\<[`DatabaseInfo`](DatabaseInfo.md)\>

***

### importData()

```ts
importData: (items) => Promise<void>;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:232](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L232)

Validates input rows and atomically replaces the object store.
Failure preserves the previous rows and versions.

#### Parameters

##### items

`TInsertInput`[]

#### Returns

`Promise`\<`void`\>
