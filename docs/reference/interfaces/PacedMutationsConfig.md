---
id: PacedMutationsConfig
title: PacedMutationsConfig
---

Defined in: [packages/db/src/paced-mutations.ts:17](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L17)

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

Defined in: [packages/db/src/paced-mutations.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L39)

Custom metadata to associate with transactions

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/paced-mutations.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L30)

Function to execute the mutation on the server.
Receives the transaction parameters containing all merged mutations.

***

### onMutate()

```ts
onMutate: (variables) => void;
```

Defined in: [packages/db/src/paced-mutations.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L25)

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

Defined in: [packages/db/src/paced-mutations.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/paced-mutations.ts#L35)

Strategy for controlling mutation execution timing
Examples: debounceStrategy, queueStrategy, throttleStrategy
