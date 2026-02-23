---
id: PendingMutation
title: PendingMutation
---

# Interface: PendingMutation\<T, TOperation, TCollection\>

Defined in: packages/db/src/types.ts:89

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

Defined in: packages/db/src/types.ts:106

***

### collection

```ts
collection: TCollection;
```

Defined in: packages/db/src/types.ts:117

***

### createdAt

```ts
createdAt: Date;
```

Defined in: packages/db/src/types.ts:115

***

### globalKey

```ts
globalKey: string;
```

Defined in: packages/db/src/types.ts:107

***

### key

```ts
key: any;
```

Defined in: packages/db/src/types.ts:109

***

### metadata

```ts
metadata: unknown;
```

Defined in: packages/db/src/types.ts:111

***

### modified

```ts
modified: T;
```

Defined in: packages/db/src/types.ts:104

***

### mutationId

```ts
mutationId: string;
```

Defined in: packages/db/src/types.ts:100

***

### optimistic

```ts
optimistic: boolean;
```

Defined in: packages/db/src/types.ts:114

Whether this mutation should be applied optimistically (defaults to true)

***

### original

```ts
original: TOperation extends "insert" ? object : T;
```

Defined in: packages/db/src/types.ts:102

***

### syncMetadata

```ts
syncMetadata: Record<string, unknown>;
```

Defined in: packages/db/src/types.ts:112

***

### type

```ts
type: TOperation;
```

Defined in: packages/db/src/types.ts:110

***

### updatedAt

```ts
updatedAt: Date;
```

Defined in: packages/db/src/types.ts:116
