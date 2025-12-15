---
id: TransactionConfig
title: TransactionConfig
---

# Interface: TransactionConfig\<T\>

Defined in: [packages/db/src/types.ts:165](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L165)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:169](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L169)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L167)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:172](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L172)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:170](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L170)
