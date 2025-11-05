---
id: ElectricCollectionConfig
title: ElectricCollectionConfig
---

# Interface: ElectricCollectionConfig\<T, TSchema\>

Defined in: [packages/electric-db-collection/src/electric.ts:80](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L80)

Configuration interface for Electric collection options

## Extends

- `Omit`\<`BaseCollectionConfig`\<`T`, `string` \| `number`, `TSchema`, `UtilsRecord`, `any`\>, `"onInsert"` \| `"onUpdate"` \| `"onDelete"`\>

## Type Parameters

### T

`T` *extends* `Row`\<`unknown`\> = `Row`\<`unknown`\>

The type of items in the collection

### TSchema

`TSchema` *extends* `StandardSchemaV1` = `never`

The schema type for validation

## Properties

### onDelete()?

```ts
optional onDelete: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:185](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L185)

Optional asynchronous handler function called before a delete operation

#### Parameters

##### params

`DeleteMutationFnParams`\<`T`\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise resolving to { txid } or void

#### Examples

```ts
// Basic Electric delete handler with txid (recommended)
onDelete: async ({ transaction }) => {
  const mutation = transaction.mutations[0]
  const result = await api.todos.delete({
    id: mutation.original.id
  })
  return { txid: result.txid }
}
```

```ts
// Use awaitMatch utility for custom matching
onDelete: async ({ transaction, collection }) => {
  const mutation = transaction.mutations[0]
  await api.todos.delete({ id: mutation.original.id })
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'delete' &&
                 message.value.id === mutation.original.id
  )
}
```

***

### onInsert()?

```ts
optional onInsert: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:128](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L128)

Optional asynchronous handler function called before an insert operation

#### Parameters

##### params

`InsertMutationFnParams`\<`T`\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise resolving to { txid } or void

#### Examples

```ts
// Basic Electric insert handler with txid (recommended)
onInsert: async ({ transaction }) => {
  const newItem = transaction.mutations[0].modified
  const result = await api.todos.create({
    data: newItem
  })
  return { txid: result.txid }
}
```

```ts
// Insert handler with multiple items - return array of txids
onInsert: async ({ transaction }) => {
  const items = transaction.mutations.map(m => m.modified)
  const results = await Promise.all(
    items.map(item => api.todos.create({ data: item }))
  )
  return { txid: results.map(r => r.txid) }
}
```

```ts
// Use awaitMatch utility for custom matching
onInsert: async ({ transaction, collection }) => {
  const newItem = transaction.mutations[0].modified
  await api.todos.create({ data: newItem })
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'insert' &&
                 message.value.name === newItem.name
  )
}
```

***

### onUpdate()?

```ts
optional onUpdate: (params) => Promise<MatchingStrategy>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:157](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L157)

Optional asynchronous handler function called before an update operation

#### Parameters

##### params

`UpdateMutationFnParams`\<`T`\>

Object containing transaction and collection information

#### Returns

`Promise`\<`MatchingStrategy`\>

Promise resolving to { txid } or void

#### Examples

```ts
// Basic Electric update handler with txid (recommended)
onUpdate: async ({ transaction }) => {
  const { original, changes } = transaction.mutations[0]
  const result = await api.todos.update({
    where: { id: original.id },
    data: changes
  })
  return { txid: result.txid }
}
```

```ts
// Use awaitMatch utility for custom matching
onUpdate: async ({ transaction, collection }) => {
  const { original, changes } = transaction.mutations[0]
  await api.todos.update({ where: { id: original.id }, data: changes })
  await collection.utils.awaitMatch(
    (message) => isChangeMessage(message) &&
                 message.headers.operation === 'update' &&
                 message.value.id === original.id
  )
}
```

***

### shapeOptions

```ts
shapeOptions: ShapeStreamOptions<GetExtensions<T>>;
```

Defined in: [packages/electric-db-collection/src/electric.ts:90](https://github.com/TanStack/db/blob/main/packages/electric-db-collection/src/electric.ts#L90)

Configuration options for the ElectricSQL ShapeStream
