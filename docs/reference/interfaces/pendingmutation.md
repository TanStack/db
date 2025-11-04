---
id: PendingMutation
title: PendingMutation
---

# Interface: PendingMutation\<T, TOperation, TCollection\>

Defined in: [packages/db/src/types.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L57)

Represents a pending mutation within a transaction
Contains information about the original and modified data, as well as metadata

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

### TOperation

`TOperation` *extends* [`OperationType`](../../type-aliases/OperationType.md) = [`OperationType`](../../type-aliases/OperationType.md)

### TCollection

`TCollection` *extends* [`Collection`](../Collection.md)\<`T`, `any`, `any`, `any`, `any`\> = [`Collection`](../Collection.md)\<`T`, `any`, `any`, `any`, `any`\>

## Properties

### changes

```ts
changes: ResolveTransactionChanges<T, TOperation>;
```

Defined in: [packages/db/src/types.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L74)

***

### collection

```ts
collection: TCollection;
```

Defined in: [packages/db/src/types.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L85)

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/db/src/types.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L83)

***

### globalKey

```ts
globalKey: string;
```

Defined in: [packages/db/src/types.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L75)

***

### key

```ts
key: any;
```

Defined in: [packages/db/src/types.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L77)

***

### metadata

```ts
metadata: unknown;
```

Defined in: [packages/db/src/types.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L79)

***

### modified

```ts
modified: T;
```

Defined in: [packages/db/src/types.ts:72](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L72)

***

### mutationId

```ts
mutationId: string;
```

Defined in: [packages/db/src/types.ts:68](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L68)

***

### optimistic

```ts
optimistic: boolean;
```

Defined in: [packages/db/src/types.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L82)

Whether this mutation should be applied optimistically (defaults to true)

***

### original

```ts
original: TOperation extends "insert" ? object : T;
```

Defined in: [packages/db/src/types.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L70)

***

### syncMetadata

```ts
syncMetadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L80)

***

### type

```ts
type: TOperation;
```

Defined in: [packages/db/src/types.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L78)

***

### updatedAt

```ts
updatedAt: Date;
```

Defined in: [packages/db/src/types.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L84)
