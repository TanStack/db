---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

# Interface: CreateOptimisticActionsOptions\<TVars, T\>

Defined in: [packages/db/src/types.ts:128](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L128)

Options for the createOptimisticAction helper

## Extends

- `Omit`\<[`TransactionConfig`](../TransactionConfig.md)\<`T`\>, `"mutationFn"`\>

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

Defined in: [packages/db/src/types.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L119)

#### Inherited from

[`TransactionConfig`](../TransactionConfig.md).[`autoCommit`](../TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L117)

Unique identifier for the transaction

#### Inherited from

```ts
Omit.id
```

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L122)

Custom metadata to associate with the transaction

#### Inherited from

```ts
Omit.metadata
```

***

### mutationFn()

```ts
mutationFn: (vars, params) => Promise<any>;
```

Defined in: [packages/db/src/types.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L135)

Function to execute the mutation on the server

#### Parameters

##### vars

`TVars`

##### params

[`MutationFnParams`](../../type-aliases/MutationFnParams.md)\<`T`\>

#### Returns

`Promise`\<`any`\>

***

### onMutate()

```ts
onMutate: (vars) => void;
```

Defined in: [packages/db/src/types.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L133)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
