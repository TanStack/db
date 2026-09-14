---
id: TransactionConfig
title: TransactionConfig
---

# Interface: TransactionConfig\<T\>

Defined in: [packages/db/src/types.ts:174](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L174)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L178)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L176)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L181)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L179)
