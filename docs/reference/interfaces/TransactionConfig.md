---
id: TransactionConfig
title: TransactionConfig
---

# Interface: TransactionConfig\<T\>

Defined in: [packages/db/src/types.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L166)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L170)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L168)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L173)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:171](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L171)
