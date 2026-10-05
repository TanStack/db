---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

Defined in: [packages/db/src/types.ts:202](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L202)

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

Defined in: [packages/db/src/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L193)

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`autoCommit`](TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L191)

Unique identifier for the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`id`](TransactionConfig.md#id)

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L196)

Custom metadata to associate with the transaction

#### Inherited from

[`TransactionConfig`](TransactionConfig.md).[`metadata`](TransactionConfig.md#metadata)

***

### mutationFn()

```ts
mutationFn: (vars, params) => Promise<any>;
```

Defined in: [packages/db/src/types.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L209)

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

Defined in: [packages/db/src/types.ts:207](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L207)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
