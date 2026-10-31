---
id: VirtualRowProps
title: VirtualRowProps
---

Defined in: [packages/db/src/virtual-props.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L78)

Virtual properties recognized on TanStack DB rows.

These properties are:
- Computed (not stored in the data model)
- Read-only (cannot be mutated directly)
- Available in queries (WHERE, ORDER BY, SELECT)
- Included when spreading rows (`...user`)

Structured whole-row selections and spreads retain source metadata.
A functional selection retains it only when returning a source row directly.
New functional objects and other projections receive the output Collection's
metadata. Selected virtual names cannot change that attribution.

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

Defined in: [packages/db/src/virtual-props.ts:116](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L116)

The ID of the source collection this row originated from.

In joins, this can help identify which collection each row came from.
Whole-row live queries preserve the upstream Collection's ID. Projected
row roots otherwise use the live-query Collection's ID.

***

### $hasPendingWrites

```ts
readonly $hasPendingWrites: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L87)

Whether this row currently has pending local optimistic writes.

This describes the row's local optimistic state, not backend upload or
acknowledgement. It is always `false` for local-only collections.

***

### $key

```ts
readonly $key: TKey;
```

Defined in: [packages/db/src/virtual-props.ts:107](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L107)

The row's key (primary identifier).

This is the same value returned by `collection.config.getKey(row)`.
Useful when you need the key in projections or computations.

***

### $origin

```ts
readonly $origin: VirtualOrigin;
```

Defined in: [packages/db/src/virtual-props.ts:99](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L99)

Collection attribution for this row's current value. `'local'` covers
optimistic rows and attributed source writes; `'remote'` covers source
writes without local attribution. See [VirtualOrigin](../type-aliases/VirtualOrigin.md) for the
key-and-timing rules, including truncate and overlapping mutations.

For local-only collections, this is always `'local'`.
Whole-row live queries preserve source attribution. Projected row roots
otherwise use the live-query Collection's attribution.
