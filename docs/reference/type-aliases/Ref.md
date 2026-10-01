---
id: Ref
title: Ref
---

```ts
type Ref<T, Nullable, IncludeVirtualProps> = T extends unknown ? RefBranch<T, Nullable, IncludeVirtualProps> : never;
```

Defined in: [packages/db/src/query/builder/types.ts:902](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L902)

Ref - The user-facing ref interface for the query builder

This is a clean type that represents a reference to a value in the query,
designed for optimal IDE experience without internal implementation details.
It provides a recursive interface that allows nested property access while
preserving optionality and nullability correctly.

The `Nullable` parameter indicates whether this ref comes from a nullable
join side (left/right/full). When `true`, the `Nullable` flag propagates
through all nested property accesses, ensuring the result type includes
`| undefined` for all fields accessed through this ref.

Inferred row-root refs include virtual properties ($hasPendingWrites, $origin,
$key, $collectionId) for querying on row metadata. The default exported `Ref<T>`
shape is suitable for reusable helpers that can accept either a row root or
a recursively traversed user object, so it does not require those fields.
Use `Ref<T, false, true>` when a helper specifically requires a row root.

Example usage:
```typescript
// Clean interface - no internal properties visible
const users: Ref<{ id: number; profile?: { bio: string } }> = { ... }
users.id // Ref<number> - clean display
users.profile?.bio // Ref<string> - nested optional access works
const rootUsers: Ref<{ id: number }, false, true> = { ... }
rootUsers.$hasPendingWrites // RefLeaf<boolean> - row-root virtual property access

// Nullable ref (left/right/full join side):
select(({ dept }) => ({ name: dept.name })) // result: string | undefined

// Spread operations work cleanly:
select(({ user }) => ({ ...user })) // Returns User type, not Ref types
```

## Type Parameters

### T

`T` = `any`

### Nullable

`Nullable` *extends* `boolean` = `false`

### IncludeVirtualProps

`IncludeVirtualProps` *extends* `boolean` = `false`
