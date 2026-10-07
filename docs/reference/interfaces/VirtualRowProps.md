---
id: VirtualRowProps
title: VirtualRowProps
---

Defined in: [packages/db/src/virtual-props.ts:67](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L67)

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

Defined in: [packages/db/src/virtual-props.ts:135](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L135)

The ID of the source collection this row originated from.

In joins, this can help identify which collection each row came from.
For live query collections, this is the ID of the upstream collection.

***

### $hasPendingWrites?

```ts
readonly optional $hasPendingWrites: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:78](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L78)

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

Defined in: [packages/db/src/virtual-props.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L127)

The row's key (primary identifier).

This is the same value returned by `collection.config.getKey(row)`.
Useful when you need the key in projections or computations.

***

### $origin

```ts
readonly $origin: VirtualOrigin;
```

Defined in: [packages/db/src/virtual-props.ts:119](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L119)

Collection attribution for this row's current value.

- `'local'`: An optimistic row or a source write attributed through a
  same-key local mutation
- `'remote'`: A source write without that local attribution

Synced Collections infer attribution from key and timing, not a source
client ID. With one local mutation and no truncate, the first queued
same-key source transaction published at successful mutation settlement
consumes local attribution. Its surviving row is `'local'`; later source
transactions are `'remote'`. A failed mutation gives those queued
writes no local attribution. A truncate can publish while a mutation remains
active, leaving its same-key row `'local'` even if the mutation later fails.
A peer write can be labeled `'local'`, and a later local confirmation can be
labeled `'remote'`.

For local-only collections, this is always `'local'`.
For live query collections, this is passed through from the source collection.

***

### ~~$synced~~

```ts
readonly $synced: boolean;
```

Defined in: [packages/db/src/virtual-props.ts:97](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L97)

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
