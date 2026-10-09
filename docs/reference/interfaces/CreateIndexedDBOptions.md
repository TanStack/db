---
id: CreateIndexedDBOptions
title: CreateIndexedDBOptions
---

Defined in: packages/db/src/indexed-db.ts:86

## Properties

### idbFactory?

```ts
optional idbFactory: IDBFactory;
```

Defined in: packages/db/src/indexed-db.ts:94

Custom IDBFactory for testing/mocking

***

### name

```ts
name: string;
```

Defined in: packages/db/src/indexed-db.ts:88

Database name

***

### onBlocked()?

```ts
optional onBlocked: (event) => void;
```

Defined in: packages/db/src/indexed-db.ts:96

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

Defined in: packages/db/src/indexed-db.ts:92

Object store names to create

***

### version

```ts
version: number;
```

Defined in: packages/db/src/indexed-db.ts:90

Schema version (increment when adding stores)
