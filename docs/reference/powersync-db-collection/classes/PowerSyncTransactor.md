---
id: PowerSyncTransactor
title: PowerSyncTransactor
---

# Class: PowerSyncTransactor

Defined in: [PowerSyncTransactor.ts:54](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L54)

Applies mutations to the PowerSync database. This method is called automatically by the collection's
insert, update, and delete operations. You typically don't need to call this directly unless you
have special transaction requirements.

## Example

```typescript
// Create a collection
const collection = createCollection(
  powerSyncCollectionOptions<Document>({
    database: db,
    table: APP_SCHEMA.props.documents,
  })
)

const addTx = createTransaction({
  autoCommit: false,
  mutationFn: async ({ transaction }) => {
    await new PowerSyncTransactor({ database: db }).applyTransaction(transaction)
  },
})

addTx.mutate(() => {
  for (let i = 0; i < 5; i++) {
    collection.insert({ id: randomUUID(), name: `tx-${i}` })
  }
})

await addTx.commit()
await addTx.isPersisted.promise
```

## Param

The transaction containing mutations to apply

## Constructors

### Constructor

```ts
new PowerSyncTransactor(options): PowerSyncTransactor;
```

Defined in: [PowerSyncTransactor.ts:58](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L58)

#### Parameters

##### options

[`TransactorOptions`](../type-aliases/TransactorOptions.md)

#### Returns

`PowerSyncTransactor`

## Properties

### database

```ts
database: AbstractPowerSyncDatabase;
```

Defined in: [PowerSyncTransactor.ts:55](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L55)

***

### pendingOperationStore

```ts
pendingOperationStore: PendingOperationStore;
```

Defined in: [PowerSyncTransactor.ts:56](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L56)

## Methods

### applyTransaction()

```ts
applyTransaction(transaction): Promise<void>;
```

Defined in: [PowerSyncTransactor.ts:66](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L66)

Persists a Transaction to the PowerSync SQLite database.

#### Parameters

##### transaction

`Transaction`\<`any`\>

#### Returns

`Promise`\<`void`\>

***

### getMutationCollectionMeta()

```ts
protected getMutationCollectionMeta(mutation): PowerSyncCollectionMeta<any>;
```

Defined in: [PowerSyncTransactor.ts:294](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L294)

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

#### Returns

[`PowerSyncCollectionMeta`](../type-aliases/PowerSyncCollectionMeta.md)\<`any`\>

***

### handleDelete()

```ts
protected handleDelete(
   mutation, 
   context, 
waitForCompletion): Promise<PendingOperation | null>;
```

Defined in: [PowerSyncTransactor.ts:221](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L221)

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

##### context

`LockContext`

##### waitForCompletion

`boolean` = `false`

#### Returns

`Promise`\<`PendingOperation` \| `null`\>

***

### handleInsert()

```ts
protected handleInsert(
   mutation, 
   context, 
waitForCompletion): Promise<PendingOperation | null>;
```

Defined in: [PowerSyncTransactor.ts:152](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L152)

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

##### context

`LockContext`

##### waitForCompletion

`boolean` = `false`

#### Returns

`Promise`\<`PendingOperation` \| `null`\>

***

### handleOperationWithCompletion()

```ts
protected handleOperationWithCompletion(
   mutation, 
   context, 
   waitForCompletion, 
handler): Promise<PendingOperation | null>;
```

Defined in: [PowerSyncTransactor.ts:263](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L263)

Helper function which wraps a persistence operation by:
- Fetching the mutation's collection's SQLite table details
- Executing the mutation
- Returning the last pending diff operation if required

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

##### context

`LockContext`

##### waitForCompletion

`boolean`

##### handler

(`tableName`, `mutation`, `serializeValue`) => `Promise`\<`void`\>

#### Returns

`Promise`\<`PendingOperation` \| `null`\>

***

### handleUpdate()

```ts
protected handleUpdate(
   mutation, 
   context, 
waitForCompletion): Promise<PendingOperation | null>;
```

Defined in: [PowerSyncTransactor.ts:187](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L187)

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

##### context

`LockContext`

##### waitForCompletion

`boolean` = `false`

#### Returns

`Promise`\<`PendingOperation` \| `null`\>

***

### processMutationMetadata()

```ts
protected processMutationMetadata(mutation): string | null;
```

Defined in: [PowerSyncTransactor.ts:313](https://github.com/powersync-ja/temp-tanstack-db/blob/main/packages/powersync-db-collection/src/PowerSyncTransactor.ts#L313)

Processes collection mutation metadata for persistence to the database.
We only support storing string metadata.

#### Parameters

##### mutation

`PendingMutation`\<`any`\>

#### Returns

`string` \| `null`

null if no metadata should be stored.
