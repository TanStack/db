---
id: TransactionScope
title: TransactionScope
---

Defined in: [packages/db/src/transactions.ts:25](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L25)

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

Defined in: [packages/db/src/transactions.ts:136](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L136)

#### Returns

`void`

***

### clearTransactionContext()

```ts
clearTransactionContext(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L100)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

#### Returns

`void`

***

### createTransaction()

```ts
createTransaction<T>(config): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:30](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L30)

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

Defined in: [packages/db/src/transactions.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L38)

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

Defined in: [packages/db/src/transactions.ts:42](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L42)

#### Returns

  \| [`Transaction`](../interfaces/Transaction.md)\<`Record`\<`string`, `unknown`\>\>
  \| `undefined`

***

### registerTransaction()

```ts
registerTransaction(transaction): void;
```

Defined in: [packages/db/src/transactions.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L83)

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

Defined in: [packages/db/src/transactions.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L105)

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

Defined in: [packages/db/src/transactions.ts:113](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L113)

Rolls back every conflicting candidate, then throws the first error.

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
unregisterTransaction(transaction, contextAlreadyCleared): void;
```

Defined in: [packages/db/src/transactions.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L89)

#### Parameters

##### transaction

[`Transaction`](../interfaces/Transaction.md)\<`any`\>

##### contextAlreadyCleared

`boolean` = `false`

#### Returns

`void`
