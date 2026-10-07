---
id: IndexedDBInstance
title: IndexedDBInstance
---

Defined in: packages/db/src/indexed-db.ts:103

A shared IndexedDB database instance.
Create with createIndexedDB() and pass to collections.

## Properties

### close()

```ts
close: () => void;
```

Defined in: packages/db/src/indexed-db.ts:115

Close the connection and mark its managed Collections as errored.

#### Returns

`void`

***

### db

```ts
readonly db: IDBDatabase;
```

Defined in: packages/db/src/indexed-db.ts:105

The underlying IDBDatabase connection

***

### idbFactory?

```ts
readonly optional idbFactory: IDBFactory;
```

Defined in: packages/db/src/indexed-db.ts:113

IDBFactory used to create this database (for testing)

***

### name

```ts
readonly name: string;
```

Defined in: packages/db/src/indexed-db.ts:107

Database name

***

### stores

```ts
readonly stores: readonly string[];
```

Defined in: packages/db/src/indexed-db.ts:111

Requested object store names (frozen); omissions do not remove stores

***

### version

```ts
readonly version: number;
```

Defined in: packages/db/src/indexed-db.ts:109

Database version
