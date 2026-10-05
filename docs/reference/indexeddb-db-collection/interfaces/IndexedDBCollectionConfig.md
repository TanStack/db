---
id: IndexedDBCollectionConfig
title: IndexedDBCollectionConfig
---

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:140](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L140)

Configuration options for creating an IndexedDB Collection

## Extends

- `BaseCollectionConfig`\<`T`, `TKey`, `TSchema`\>

## Type Parameters

### T

`T` *extends* `object` = `object`

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

## Properties

### db

```ts
db: IndexedDBInstance;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:149](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L149)

IndexedDB instance from createIndexedDB()
REQUIRED - must create database before collections

***

### name

```ts
name: string;
```

Defined in: [.codex/worktrees/pr-1179-review/tanstack-db/packages/indexeddb-db-collection/src/indexeddb.ts:155](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L155)

Name of the object store within the database
Must exist in the underlying database
