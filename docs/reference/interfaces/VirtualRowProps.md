---
id: VirtualRowProps
title: VirtualRowProps
---

# Interface: VirtualRowProps\<TKey\>

Defined in: [packages/db/src/virtual-props.ts:57](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L57)

Virtual properties available on every row in TanStack DB collections.

These properties are:
- Computed (not stored in the data model)
- Read-only (cannot be mutated directly)
- Available in queries (WHERE, ORDER BY, SELECT)
- Included when spreading rows (`...user`)

## Examples

```typescript
// Accessing virtual properties on a row
const user = collection.get('user-1')
if (user.$synced) {
  console.log('No pending local optimistic writes for this row')
}
if (user.$origin === 'local') {
  console.log('Created/modified locally')
}
```

```typescript
// Using virtual properties in queries
const ordersWithoutLocalWrites = createLiveQueryCollection({
  query: (q) => q
    .from({ order: orders })
    .where(({ order }) => eq(order.$synced, true))
})
```

## Type Parameters

### TKey

`TKey` *extends* `string` \| `number` = `string` \| `number`

The type of the row's key (string or number)

## Properties

### $collectionId

```ts
readonly $collectionId: string;
```

Defined in: [packages/db/src/virtual-props.ts:96](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L96)

The ID of the source collection this row originated from.

In joins, this can help identify which collection each row came from.
For live query collections, this is the ID of the upstream collection.

***

### $key

```ts
readonly $key: TKey;
```

Defined in: [packages/db/src/virtual-props.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L88)

The row's key (primary identifier).

This is the same value returned by `collection.config.getKey(row)`.
Useful when you need the key in projections or computations.

***

### $origin

```ts
readonly $origin: VirtualOrigin;
```

Defined in: [packages/db/src/virtual-props.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L80)

Origin of the last confirmed change to this row, from the current client's perspective.

- `'local'`: The change originated from this client
- `'remote'`: The change was received via sync

For local-only collections, this is always `'local'`.
For live query collections, this is passed through from the source collection.

***

### $synced

```ts
readonly $synced: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:69](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L69)

Whether this row currently has no pending local optimistic mutations in
this collection's visible projection.

- `true`: No pending local optimistic mutation currently affects this row
- `false`: One or more pending local optimistic mutations affect this row

This is a local write/projection status. It does not prove that a backend
has uploaded, confirmed, or read back the row. Adapters that need stronger
backend observation semantics should keep their mutation function pending
until that observation has happened, or expose adapter-specific status.

For local-only collections (no sync), this is always `true`.
For live query collections, this is passed through from the source collection.
