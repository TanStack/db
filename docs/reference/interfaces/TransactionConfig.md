---
id: TransactionConfig
title: TransactionConfig
---

# Interface: TransactionConfig\<T\>

Defined in: [packages/db/src/types.ts:146](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L146)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit?

```ts
optional autoCommit: boolean;
```

Defined in: [packages/db/src/types.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L150)

***

### id?

```ts
optional id: string;
```

Defined in: [packages/db/src/types.ts:148](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L148)

Unique identifier for the transaction

***

### metadata?

```ts
optional metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/types.ts:153](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L153)

Custom metadata to associate with the transaction

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/types.ts:151](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L151)
