---
id: IndexedDBInstance
title: IndexedDBInstance
---

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:107](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L107)

A shared IndexedDB database instance.
Create with createIndexedDB() and pass to collections.

## Properties

### close()

```ts
close: () => void;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:119](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L119)

Close the database connection

#### Returns

`void`

***

### db

```ts
readonly db: IDBDatabase;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:109](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L109)

The underlying IDBDatabase connection

***

### idbFactory?

```ts
readonly optional idbFactory: IDBFactory;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:117](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L117)

IDBFactory used to create this database (for testing)

***

### name

```ts
readonly name: string;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:111](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L111)

Database name

***

### stores

```ts
readonly stores: readonly string[];
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:115](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L115)

Requested object store names (frozen); omissions do not remove stores

***

### version

```ts
readonly version: number;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:113](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L113)

Database version
