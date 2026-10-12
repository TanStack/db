---
id: IndexedDBInstance
title: IndexedDBInstance
---

Defined in: [packages/db/src/indexed-db.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L112)

A shared IndexedDB database instance.
Create with createIndexedDB() and pass to collections.

## Properties

### close()

```ts
close: () => void;
```

Defined in: [packages/db/src/indexed-db.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L124)

Close the connection and mark its managed Collections as errored.

#### Returns

`void`

***

### db

```ts
readonly db: IDBDatabase;
```

Defined in: [packages/db/src/indexed-db.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L114)

The underlying IDBDatabase connection

***

### idbFactory?

```ts
readonly optional idbFactory: IDBFactory;
```

Defined in: [packages/db/src/indexed-db.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L122)

IDBFactory used to create this database (for testing)

***

### name

```ts
readonly name: string;
```

Defined in: [packages/db/src/indexed-db.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L116)

Database name

***

### stores

```ts
readonly stores: readonly string[];
```

Defined in: [packages/db/src/indexed-db.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L120)

Requested object store names (frozen); omissions do not remove stores

***

### version

```ts
readonly version: number;
```

Defined in: [packages/db/src/indexed-db.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L118)

Database version
