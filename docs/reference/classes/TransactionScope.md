---
id: TransactionScope
title: TransactionScope
---

Defined in: [packages/db/src/transactions.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L22)

## Constructors

### Constructor

```ts
new TransactionScope(): TransactionScope;
```

#### Returns

`TransactionScope`

## Methods

### clear()

```ts
clear(): void;
```

Defined in: [packages/db/src/transactions.ts:120](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L120)

#### Returns

`void`

***

### createTransaction()

```ts
createTransaction<T>(config): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:27](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L27)

#### Type Parameters

##### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

#### Parameters

##### config

[`TransactionConfig`](../interfaces/TransactionConfig.md)\<`T`\>

#### Returns

[`Transaction`](../interfaces/Transaction.md)\<`T`\>

***

### getActiveTransaction()

```ts
getActiveTransaction(): 
  | Transaction<Record<string, unknown>>
  | undefined;
```

Defined in: [packages/db/src/transactions.ts:35](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L35)

#### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

***

### getActiveTransactionForCollection()

```ts
getActiveTransactionForCollection(): 
  | Transaction<Record<string, unknown>>
  | undefined;
```

Defined in: [packages/db/src/transactions.ts:39](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L39)

#### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

***

### registerTransaction()

```ts
registerTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L78)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`

***

### removeTransaction()

```ts
removeTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L94)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`

***

### rollbackConflictingTransactions()

```ts
rollbackConflictingTransactions(transaction, mutationIds): void;
```

Defined in: [packages/db/src/transactions.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L103)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

##### mutationIds

`Set`\<`string`\>

#### Returns

`void`

***

### unregisterTransaction()

```ts
unregisterTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L84)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`
