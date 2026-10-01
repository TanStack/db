---
id: VirtualRowProps
title: VirtualRowProps
---

Defined in: [packages/db/src/virtual-props.ts:60](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L60)

Virtual properties recognized on TanStack DB rows. `$hasPendingWrites` is optional in this compatibility type because `hasVirtualProps` accepts legacy four-field rows. Collection-published rows use `WithVirtualProps`, which requires it.

These properties are:
- Computed (not stored in the data model)
- Read-only (cannot be mutated directly)
- Available in queries (WHERE, ORDER BY, SELECT)
- Included when spreading rows (`...user`)

## Examples

```typescript
// Accessing virtual properties on a row
const user = collection.get('user-1')
if (!user.$hasPendingWrites) {
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
    .where(({ order }) => eq(order.$hasPendingWrites, false))
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

Defined in: [packages/db/src/virtual-props.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L117)

The ID of the source collection this row originated from.

In joins, this can help identify which collection each row came from.
For live query collections, this is the ID of the upstream collection.

***

### $key

```ts
readonly $key: TKey;
```

Defined in: [packages/db/src/virtual-props.ts:109](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L109)

The row's key (primary identifier).

This is the same value returned by `collection.config.getKey(row)`.
Useful when you need the key in projections or computations.

***

### $hasPendingWrites

```ts
readonly $hasPendingWrites?: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L71)

Whether this row currently has pending local optimistic writes. It does not indicate backend upload or acknowledgement, and is always `false` for local-only collections. Collection-published rows always provide it.

***

### $origin

```ts
readonly $origin: VirtualOrigin;
```

Defined in: [packages/db/src/virtual-props.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L101)

Origin of the last confirmed change to this row, from the current client's perspective.

- `'local'`: The change originated from this client
- `'remote'`: The change was received via sync

For local-only collections, this is always `'local'`.
For live query collections, this is passed through from the source collection.

***

### ~~$synced~~

```ts
readonly $synced: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L90)

Whether this row currently has no pending local optimistic writes.

- `true`: No pending local optimistic mutation currently affects this row
- `false`: One or more pending local optimistic mutations currently affect this row

This is local mutation status. It does not prove that a backend has uploaded,
confirmed, or read back the row. If you need backend-confirmed status, keep
your mutation function pending until that backend observation has happened,
or expose adapter-specific status.

For local-only collections (no sync), this is always `true`.
For live query collections, this is passed through from the source collection.

#### Deprecated

Use `!row.$hasPendingWrites` instead. This alias will be removed in the 1.0 RC.
