---
id: CreateOptimisticActionsOptions
title: CreateOptimisticActionsOptions
---

# Interface: CreateOptimisticActionsOptions\<TVars, T\>

Defined in: [packages/db/src/types.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L159)

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

Defined in: [packages/db/src/types.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L150)

#### Inherited from

[`TransactionConfig`](../TransactionConfig.md).[`autoCommit`](../TransactionConfig.md#autocommit)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L148)

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

Defined in: [packages/db/src/types.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L153)

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

Defined in: [packages/db/src/types.ts:166](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L166)

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

Defined in: [packages/db/src/types.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L164)

Function to apply optimistic updates locally before the mutation completes

#### Parameters

##### vars

`TVars`

#### Returns

`void`
