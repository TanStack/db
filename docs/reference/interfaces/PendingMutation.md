---
id: PendingMutation
title: PendingMutation
---

Defined in: [packages/db/src/types.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L97)

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

Defined in: [packages/db/src/types.ts:114](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L114)

***

### collection

```ts
collection: TCollection;
```

Defined in: [packages/db/src/types.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L127)

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/db/src/types.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L125)

***

### globalKey

```ts
globalKey: string;
```

Defined in: [packages/db/src/types.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L115)

***

### key

```ts
key: TCollection extends Collection<any, TKey, any, any, any> ? TKey : never;
```

Defined in: [packages/db/src/types.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L117)

***

### metadata

```ts
metadata: unknown;
```

Defined in: [packages/db/src/types.ts:121](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L121)

***

### modified

```ts
modified: T;
```

Defined in: [packages/db/src/types.ts:112](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L112)

***

### mutationId

```ts
mutationId: string;
```

Defined in: [packages/db/src/types.ts:108](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L108)

***

### optimistic

```ts
optimistic: boolean;
```

Defined in: [packages/db/src/types.ts:124](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L124)

Whether this mutation should be applied optimistically (defaults to true)

***

### original

```ts
original: TOperation extends "insert" ? object : T;
```

Defined in: [packages/db/src/types.ts:110](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L110)

***

### syncMetadata

```ts
syncMetadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L122)

***

### type

```ts
type: TOperation;
```

Defined in: [packages/db/src/types.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L120)

***

### updatedAt

```ts
updatedAt: Date;
```

Defined in: [packages/db/src/types.ts:126](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L126)
