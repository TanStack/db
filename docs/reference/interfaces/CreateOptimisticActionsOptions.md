---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

# Interface: CreateOptimisticActionsOptions\<TVars, T\>

Defined in: [packages/db/src/types.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L178)

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

Defined in: [packages/db/src/types.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L169)

#### Inherited from

[`TransactionConfig`](../TransactionConfig.md).[`autoCommit`](../TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L167)

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

Defined in: [packages/db/src/types.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L172)

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

Defined in: [packages/db/src/types.ts:185](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L185)

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

Defined in: [packages/db/src/types.ts:183](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L183)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
