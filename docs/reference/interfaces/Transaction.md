---
id: Transaction
title: Transaction
---

Defined in: [packages/db/src/transactions.ts:350](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L350)

## Type Parameters

### T

`T` *extends* `object` = `Record`\<`string`, `unknown`\>

## Properties

### autoCommit

```ts
autoCommit: boolean;
```

Defined in: [packages/db/src/transactions.ts:362](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L362)

***

### collections

```ts
readonly collections: Set<Collection<any, any, any, any, any>>;
```

Defined in: [packages/db/src/transactions.ts:359](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L359)

Every Collection that has tracked this transaction. Settlement recomputes
each of them, including one whose mutations merged away.

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/db/src/transactions.ts:363](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L363)

***

### error?

```ts
optional error: object;
```

Defined in: [packages/db/src/transactions.ts:366](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L366)

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

Defined in: [packages/db/src/transactions.ts:351](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L351)

***

### metadata

```ts
metadata: Record<string, unknown>;
```

Defined in: [packages/db/src/transactions.ts:365](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L365)

***

### mutationFn

```ts
mutationFn: MutationFn<T>;
```

Defined in: [packages/db/src/transactions.ts:353](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L353)

***

### mutations

```ts
mutations: PendingMutation<T, OperationType, Collection<T, any, any, any, any>>[];
```

Defined in: [packages/db/src/transactions.ts:354](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L354)

***

### sequenceNumber

```ts
sequenceNumber: number;
```

Defined in: [packages/db/src/transactions.ts:364](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L364)

***

### state

```ts
state: TransactionState;
```

Defined in: [packages/db/src/transactions.ts:352](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L352)

## Methods

### applyMutations()

```ts
applyMutations(mutations): void;
```

Defined in: [packages/db/src/transactions.ts:566](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L566)

Apply new mutations to this transaction, intelligently merging with existing mutations

When mutations operate on the same item (same globalKey), they are merged according to
the following rules:

- **insert + update** → insert (merge changes, keep empty original)
- **insert + delete** → removed (mutations cancel each other out)
- **update + delete** → delete (delete dominates)
- **update + update** → update (union changes, keep first original)
- **delete + insert** → removed if restored, otherwise update
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

Defined in: [packages/db/src/transactions.ts:745](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L745)

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

Defined in: [packages/db/src/transactions.ts:817](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L817)

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

### completeWithoutCommit()

```ts
completeWithoutCommit(): void;
```

Defined in: [packages/db/src/transactions.ts:411](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L411)

**`Internal`**

Complete a transaction whose work was already applied outside commit().

#### Returns

`void`

***

### mutate()

```ts
mutate(callback): Transaction<T>;
```

Defined in: [packages/db/src/transactions.ts:475](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L475)

Execute collection operations within this transaction

#### Parameters

##### callback

() => `void`

Synchronous function containing collection operations to group together.
The transaction context is active only for the synchronous duration of this callback.
Async work should happen in `mutationFn`; collection operations after `await` boundaries
inside this callback will not be part of this transaction. For manual transactions, call
`mutate` multiple times before committing to add more synchronous operations to the same
transaction. If this callback throws, its mutations are removed before the
error reaches the caller; mutations from earlier successful calls remain.

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

await tx.when('settled')
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

Defined in: [packages/db/src/transactions.ts:638](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L638)

Rollback the transaction and any conflicting transactions

#### Parameters

##### config?

Configuration for rollback behavior

###### error?

`Error`

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
  await tx.when('settled')
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

Defined in: [packages/db/src/transactions.ts:417](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L417)

#### Parameters

##### newState

[`TransactionState`](../type-aliases/TransactionState.md)

#### Returns

`void`

***

### touchCollection()

```ts
touchCollection(releasedHold): void;
```

Defined in: [packages/db/src/transactions.ts:684](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L684)

Tell every Collection that tracked this transaction that it changed. A
failure in one Collection must not leave the others showing this
transaction's settled optimistic state, so each one recomputes before the
first error is thrown. A settled transaction then empties its set of
tracking Collections. Its mutations still name their Collection.

#### Parameters

##### releasedHold

`boolean` = `false`

#### Returns

`void`

***

### when()

```ts
when(_state): Promise<Transaction<T>>;
```

Defined in: [packages/db/src/transactions.ts:406](https://github.com/TanStack/db/blob/main/packages/db/src/transactions.ts#L406)

Wait for this transaction to complete successfully or fail.

The promise resolves with this transaction on success and rejects with
the original error on failure (or `undefined` for a rollback without an
error). For non-empty commits, this
boundary is the mutation function's completion; it does not inherently
prove backend acknowledgement or read-back unless the mutation function
or an adapter-registered commit work item waits for it.

#### Parameters

##### \_state

`"settled"`

#### Returns

`Promise`\<`Transaction`\<`T`\>\>
