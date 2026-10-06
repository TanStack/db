---
id: IndexedDBInstance
title: IndexedDBInstance
---

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:106](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L106)

A shared IndexedDB database instance.
Create with createIndexedDB() and pass to collections.

## Properties

### close()

```ts
close: () => void;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:118](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L118)

Close the connection and mark its managed Collections as errored.

#### Returns

`void`

***

### db

```ts
readonly db: IDBDatabase;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:108](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L108)

The underlying IDBDatabase connection

***

### idbFactory?

```ts
readonly optional idbFactory: IDBFactory;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:116](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L116)

IDBFactory used to create this database (for testing)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:110](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L110)

Database name

***

### stores

```ts
readonly stores: readonly string[];
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:114](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L114)

Requested object store names (frozen); omissions do not remove stores

***

### version

```ts
readonly version: number;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:112](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L112)

Database version
