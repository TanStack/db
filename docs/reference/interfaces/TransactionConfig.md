---
id: TransactionConfig
title: TransactionConfig
---

Defined in: [packages/db/src/types.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L189)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:193](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L193)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:191](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L191)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L196)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L194)
