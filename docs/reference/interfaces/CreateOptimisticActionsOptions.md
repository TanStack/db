---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

# Interface: CreateOptimisticActionsOptions\<TVars, T\>

Defined in: [packages/db/src/types.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L179)

Options for the createOptimisticAction helper

## Extends

- `Omit`\<[`TransactionConfig`](TransactionConfig.md)\<`T`\>, `"mutationFn"`\>

## Type Parameters

### TVars

`TVars` = `unknown`

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L170)

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`autoCommit`](TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:168](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L168)

Unique identifier for the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`id`](TransactionConfig.md#id)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:173](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L173)

Custom metadata to associate with the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`metadata`](TransactionConfig.md#metadata)

***

### mutationFn()

```ts
mutationFn: (vars, params) => Promise<any>;
```

Defined in: [packages/db/src/types.ts:186](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L186)

Function to execute the mutation on the server

#### Parameters

##### vars

`TVars`

##### params

[`MutationFnParams`](../type-aliases/MutationFnParams.md)\<`T`\>

#### Returns

`Promise`\<`any`\>

***

### onMutate()

```ts
onMutate: (vars) => void;
```

Defined in: [packages/db/src/types.ts:184](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L184)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
