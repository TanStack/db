---
id: PendingMutation
title: PendingMutation
---

# Interface: PendingMutation\<T, TOperation, TCollection\>

Defined in: [packages/db/src/types.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L88)

Represents a pending mutation within a transaction
Contains information about the original and modified data, as well as metadata

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TOperation

`TOperation` *extends* [`OperationType`](../type-aliases/OperationType.md) = [`OperationType`](../type-aliases/OperationType.md)

### TCollection

`TCollection` *extends* [`Collection`](Collection.md)\<`T`, `any`, `any`, `any`, `any`\> = [`Collection`](Collection.md)\<`T`, `any`, `any`, `any`, `any`\>

## Properties

### changes

```ts
changes: ResolveTransactionChanges<T, TOperation>;
```

Defined in: [packages/db/src/types.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L105)

***

### collection

```ts
collection: TCollection;
```

Defined in: [packages/db/src/types.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L116)

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/db/src/types.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L114)

***

### globalKey

```ts
globalKey: string;
```

Defined in: [packages/db/src/types.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L106)

***

### key

```ts
key: any;
```

Defined in: [packages/db/src/types.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L108)

***

### metadata

```ts
metadata: unknown;
```

Defined in: [packages/db/src/types.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L110)

***

### modified

```ts
modified: T;
```

Defined in: [packages/db/src/types.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L103)

***

### mutationId

```ts
mutationId: string;
```

Defined in: [packages/db/src/types.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L99)

***

### optimistic

```ts
optimistic: boolean;
```

Defined in: [packages/db/src/types.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L113)

Whether this mutation should be applied optimistically (defaults to true)

***

### original

```ts
original: TOperation extends "insert" ? object : T;
```

Defined in: [packages/db/src/types.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L101)

***

### syncMetadata

```ts
syncMetadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:111](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L111)

***

### type

```ts
type: TOperation;
```

Defined in: [packages/db/src/types.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L109)

***

### updatedAt

```ts
updatedAt: Date;
```

Defined in: [packages/db/src/types.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L115)
