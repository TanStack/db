---
id: TransactionScope
title: TransactionScope
---

# Class: TransactionScope

Defined in: [packages/db/src/transactions.ts:21](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L21)

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

Defined in: [packages/db/src/transactions.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L119)

#### Returns

`void`

***

### createTransaction()

```ts
createTransaction<T>(config): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:26](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L26)

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

Defined in: [packages/db/src/transactions.ts:34](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L34)

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

Defined in: [packages/db/src/transactions.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L38)

#### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

***

### registerTransaction()

```ts
registerTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:77](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L77)

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

Defined in: [packages/db/src/transactions.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L93)

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

Defined in: [packages/db/src/transactions.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L102)

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

Defined in: [packages/db/src/transactions.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L83)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`
