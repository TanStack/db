---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

# Interface: CreateOptimisticActionsOptions\<TVars, T\>

Defined in: [packages/db/src/types.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L187)

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

Defined in: [packages/db/src/types.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L178)

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`autoCommit`](TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:176](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L176)

Unique identifier for the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`id`](TransactionConfig.md#id)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:181](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L181)

Custom metadata to associate with the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`metadata`](TransactionConfig.md#metadata)

***

### mutationFn()

```ts
mutationFn: (vars, params) => Promise<any>;
```

Defined in: [packages/db/src/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L194)

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

Defined in: [packages/db/src/types.ts:192](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L192)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
