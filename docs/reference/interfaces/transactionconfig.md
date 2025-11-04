---
id: TransactionConfig
title: TransactionConfig
---

# Interface: TransactionConfig\<T\>

Defined in: [packages/db/src/types.ts:115](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L115)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L119)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L117)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:122](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L122)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L120)
