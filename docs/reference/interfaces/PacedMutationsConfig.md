---
id: PacedMutationsConfig
title: PacedMutationsConfig
---

# Interface: PacedMutationsConfig\<TVariables, T\>

Defined in: packages/db/src/paced-mutations.ts:8

Configuration for creating a paced mutations manager

## Type Parameters

### TVariables

`TVariables` = `unknown`

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: packages/db/src/paced-mutations.ts:30

Custom metadata to associate with transactions

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: packages/db/src/paced-mutations.ts:21

Function to execute the mutation on the server.
Receives the transaction parameters containing all merged mutations.

***

### onMutate()

```ts
onMutate: (variables) => void;
```

Defined in: packages/db/src/paced-mutations.ts:16

Callback to apply optimistic updates immediately.
Receives the variables passed to the mutate function.

#### Parameters

##### variables

`TVariables`

#### Returns

`void`

***

### strategy

```ts
strategy: Strategy;
```

Defined in: packages/db/src/paced-mutations.ts:26

Strategy for controlling mutation execution timing
Examples: debounceStrategy, queueStrategy, throttleStrategy
