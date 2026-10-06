---
id: IndexedDBCollectionConfig
title: IndexedDBCollectionConfig
---

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:139](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L139)

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

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:148](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L148)

IndexedDB instance from createIndexedDB()
REQUIRED - must create database before collections

***

### name

```ts
name: string;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:154](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L154)

Name of the object store within the database
Must exist in the underlying database
