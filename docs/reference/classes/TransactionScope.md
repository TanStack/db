---
id: TransactionScope
title: TransactionScope
---

# Class: TransactionScope

Defined in: [packages/db/src/transactions.ts:20](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L20)

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

Defined in: [packages/db/src/transactions.ts:118](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L118)

#### Returns

`void`

***

### createTransaction()

```ts
createTransaction<T>(config): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L25)

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

Defined in: [packages/db/src/transactions.ts:33](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L33)

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

Defined in: [packages/db/src/transactions.ts:37](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L37)

#### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

***

### registerTransaction()

```ts
registerTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L76)

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

Defined in: [packages/db/src/transactions.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L92)

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

Defined in: [packages/db/src/transactions.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L101)

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

Defined in: [packages/db/src/transactions.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L82)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`
