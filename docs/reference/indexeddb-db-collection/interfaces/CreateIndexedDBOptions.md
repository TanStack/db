---
id: CreateIndexedDBOptions
title: CreateIndexedDBOptions
---

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:89](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L89)

## Properties

### idbFactory?

```ts
optional idbFactory: IDBFactory;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:97](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L97)

Custom IDBFactory for testing/mocking

***

### name

```ts
name: string;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:91](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L91)

Database name

***

### onBlocked()?

```ts
optional onBlocked: (event) => void;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:99](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L99)

Reports a native blocker without settling the open request.

#### Parameters

##### event

`IDBVersionChangeEvent`

#### Returns

`void`

***

### stores

```ts
stores: readonly string[];
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:95](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L95)

Object store names to create

***

### version

```ts
version: number;
```

Defined in: [packages/indexeddb-db-collection/src/indexeddb.ts:93](https://github.com/TanStack/db/blob/main/packages/indexeddb-db-collection/src/indexeddb.ts#L93)

Schema version (increment when adding stores)
