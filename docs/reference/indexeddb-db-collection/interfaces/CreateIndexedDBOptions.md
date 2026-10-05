---
id: CreateIndexedDBOptions
title: CreateIndexedDBOptions
---

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:92](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L92)

## Properties

### idbFactory?

```ts
optional idbFactory: IDBFactory;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:100](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L100)

Custom IDBFactory for testing/mocking

***

### name

```ts
name: string;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:94](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L94)

Database name

***

### stores

```ts
stores: readonly string[];
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:98](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L98)

Object store names to create

***

### version

```ts
version: number;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:96](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L96)

Schema version (increment when adding stores)
