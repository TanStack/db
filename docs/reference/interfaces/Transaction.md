---
id: Transaction
title: Transaction
---

# Interface: Transaction\<T\>

Defined in: [packages/db/src/transactions.ts:209](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L209)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit

```ts
autoCommit: boolean;
```

Defined in: [packages/db/src/transactions.ts:227](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L227)

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/db/src/transactions.ts:228](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L228)

***

### error?

```ts
optional error: object;
```

Defined in: [packages/db/src/transactions.ts:231](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L231)

#### error

```ts
error: Error;
```

#### message

```ts
message: string;
```

***

### id

```ts
id: string;
```

Defined in: [packages/db/src/transactions.ts:210](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L210)

***

### isPersisted

```ts
isPersisted: Deferred<Transaction<T>>;
```

Defined in: [packages/db/src/transactions.ts:226](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L226)

Deferred that settles when this transaction settles.

Await `isPersisted.promise`, not `isPersisted` itself. The promise resolves
when the transaction completes successfully and rejects if the transaction
fails or is rolled back.

For non-empty commits, the mutation function is the normal settlement
boundary. This does not inherently prove that a backend has uploaded,
confirmed, or read back the write unless the mutation function waits for
that backend observation before returning.

***

### metadata

```ts
metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/transactions.ts:230](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L230)

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/transactions.ts:212](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L212)

***

### mutations

```ts
mutations: PendingMutation<T, OperationType, Collection<T, any, any, any, any>>[];
```

Defined in: [packages/db/src/transactions.ts:213](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L213)

***

### sequenceNumber

```ts
sequenceNumber: number;
```

Defined in: [packages/db/src/transactions.ts:229](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L229)

***

### state

```ts
state: TransactionState;
```

Defined in: [packages/db/src/transactions.ts:211](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L211)

## Methods

### applyMutations()

```ts
applyMutations(mutations): void;
```

Defined in: [packages/db/src/transactions.ts:348](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L348)

Apply new mutations to this transaction, intelligently merging with existing mutations

When mutations operate on the same item (same globalKey), they are merged according to
the following rules:

- **insert + update** → insert (merge changes, keep empty original)
- **insert + delete** → removed (mutations cancel each other out)
- **update + delete** → delete (delete dominates)
- **update + update** → update (union changes, keep first original)
- **same type** → replace with latest

This merging reduces over-the-wire churn and keeps the optimistic local view
aligned with user intent.

#### Parameters

##### mutations

[`PendingMutation`](PendingMutation.md)\<`any`, [`OperationType`](../type-aliases/OperationType.md), [`Collection`](Collection.md)\<`any`, `any`, `any`, `any`, `any`\>\>[]

Array of new mutations to apply

#### Returns

`void`

***

### commit()

```ts
commit(): Promise<Transaction<T>>;
```

Defined in: [packages/db/src/transactions.ts:505](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L505)

Commit the transaction and execute the mutation function

#### Returns

`Promise`\<`Transaction`\<`T`\>\>

Promise that resolves to this transaction when complete

#### Examples

```ts
// Manual commit (when autoCommit is false)
const tx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await api.saveChanges(transaction.mutations)
  }
})

tx.mutate(() => {
  collection.insert({ id: "1", text: "Buy milk" })
})

await tx.commit() // Manually commit
```

```ts
// Handle commit errors
try {
  const tx = createTransaction({
    mutationFn: async () => { throw new Error("API failed") }
  })

  tx.mutate(() => {
    collection.insert({ id: "1", text: "Item" })
  })

  await tx.commit()
} catch (error) {
  console.log('Commit failed, transaction rolled back:', error)
}
```

```ts
// Check transaction state after commit
await tx.commit()
console.log(tx.state) // "completed" or "failed"
```

***

### compareCreatedAt()

```ts
compareCreatedAt(other): number;
```

Defined in: [packages/db/src/transactions.ts:559](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L559)

Compare two transactions by their createdAt time and sequence number in order
to sort them in the order they were created.

#### Parameters

##### other

`Transaction`\<`any`\>

The other transaction to compare to

#### Returns

`number`

-1 if this transaction was created before the other, 1 if it was created after, 0 if they were created at the same time

***

### mutate()

```ts
mutate(callback): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:308](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L308)

Execute collection operations within this transaction

#### Parameters

##### callback

() => `void`

Synchronous function containing collection operations to group together.
The transaction context is active only for the synchronous duration of this callback.
Async work should happen in `mutationFn`; collection operations after `await` boundaries
inside this callback will not be part of this transaction. For manual transactions, call
`mutate` multiple times before committing to add more synchronous operations to the same
transaction.

#### Returns

`Transaction`\<`T`\>

This transaction for chaining

#### Examples

```ts
// Group multiple operations
const tx = createTransaction({ mutationFn: async () => {
  // Send to API
}})

tx.mutate(() => {
  collection.insert({ id: "1", text: "Buy milk" })
  collection.update("2", draft => { draft.completed = true })
  collection.delete("3")
})

await tx.isPersisted.promise
```

```ts
// Handle mutate errors
try {
  tx.mutate(() => {
    collection.insert({ id: "invalid" }) // This might throw
  })
} catch (error) {
  console.log('Mutation failed:', error)
}
```

```ts
// Manual commit control
const tx = createTransaction({ autoCommit: false, mutationFn: async () => {} })

tx.mutate(() => {
  collection.insert({ id: "1", text: "Item" })
})

// Add more synchronous mutations to the same transaction
tx.mutate(() => {
  collection.update("1", draft => { draft.text = "Updated item" })
})

// Commit later when ready
await tx.commit()
```

***

### rollback()

```ts
rollback(config?): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:422](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L422)

Rollback the transaction and any conflicting transactions

#### Parameters

##### config?

Configuration for rollback behavior

###### isSecondaryRollback?

`boolean`

#### Returns

`Transaction`\<`T`\>

This transaction for chaining

#### Examples

```ts
// Manual rollback
const tx = createTransaction({ mutationFn: async () => {
  // Send to API
}})

tx.mutate(() => {
  collection.insert({ id: "1", text: "Buy milk" })
})

// Rollback if needed
if (shouldCancel) {
  tx.rollback()
}
```

```ts
// Handle rollback cascade (automatic)
const tx1 = createTransaction({ mutationFn: async () => {} })
const tx2 = createTransaction({ mutationFn: async () => {} })

tx1.mutate(() => collection.update("1", draft => { draft.value = "A" }))
tx2.mutate(() => collection.update("1", draft => { draft.value = "B" })) // Same item

tx1.rollback() // This will also rollback tx2 due to conflict
```

```ts
// Handle rollback in error scenarios
try {
  await tx.isPersisted.promise
} catch (error) {
  console.log('Transaction was rolled back:', error)
  // Transaction automatically rolled back on mutation function failure
}
```

***

### setState()

```ts
setState(newState): void;
```

Defined in: [packages/db/src/transactions.ts:251](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L251)

#### Parameters

##### newState

[`TransactionState`](../type-aliases/TransactionState.md)

#### Returns

`void`

***

### touchCollection()

```ts
touchCollection(): void;
```

Defined in: [packages/db/src/transactions.ts:450](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L450)

#### Returns

`void`
