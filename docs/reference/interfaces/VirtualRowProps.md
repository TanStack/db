---
id: VirtualRowProps
title: VirtualRowProps
---

Defined in: [packages/db/src/virtual-props.ts:76](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L76)

Virtual properties recognized on TanStack DB rows. The new
`$hasPendingWrites` field is optional here so legacy four-field rows accepted
by `hasVirtualProps` remain assignable. Rows returned by collections use
`WithVirtualProps`, which requires it.

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
  console.log('Row has local attribution')
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

Defined in: [packages/db/src/virtual-props.ts:133](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L133)

The ID of the source collection this row originated from.

In joins, this can help identify which collection each row came from.
For live query collections, this is the ID of the upstream collection.

***

### $hasPendingWrites?

```ts
readonly optional $hasPendingWrites: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L87)

Whether this row currently has pending local optimistic writes.

This describes the row's local optimistic state, not backend upload or
acknowledgement. It is always `false` for local-only collections. It is
optional only for compatibility with legacy rows; collection-published
rows always provide it.

***

### $key

```ts
readonly $key: TKey;
```

Defined in: [packages/db/src/virtual-props.ts:125](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L125)

The row's key (primary identifier).

This is the same value returned by `collection.config.getKey(row)`.
Useful when you need the key in projections or computations.

***

### $origin

```ts
readonly $origin: VirtualOrigin;
```

Defined in: [packages/db/src/virtual-props.ts:117](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L117)

Collection attribution for this row's current value. `'local'` covers
optimistic rows and attributed source writes; `'remote'` covers source
writes without local attribution. See [VirtualOrigin](../type-aliases/VirtualOrigin.md) for the
key-and-timing rules, including truncate and overlapping mutations.

For local-only collections, this is always `'local'`.
For live query collections, this is passed through from the source collection.

***

### ~~$synced~~

```ts
readonly $synced: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:106](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L106)

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

Use `!row.$hasPendingWrites` instead. This alias will be
removed in the 1.0 RC.
