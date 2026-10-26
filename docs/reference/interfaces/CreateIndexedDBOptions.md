---
id: CreateIndexedDBOptions
title: CreateIndexedDBOptions
---

Defined in: [packages/db/src/indexed-db.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L99)

## Properties

### idbFactory?

```ts
optional idbFactory: IDBFactory;
```

Defined in: [packages/db/src/indexed-db.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L107)

Custom IDBFactory for testing/mocking

***

### name

```ts
name: string;
```

Defined in: [packages/db/src/indexed-db.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L101)

Database name

***

### onBlocked()?

```ts
optional onBlocked: (event) => void;
```

Defined in: [packages/db/src/indexed-db.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L109)

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

Defined in: [packages/db/src/indexed-db.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L105)

Object store names to create

***

### version

```ts
version: number;
```

Defined in: [packages/db/src/indexed-db.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/indexed-db.ts#L103)

Schema version (increment when adding stores)
