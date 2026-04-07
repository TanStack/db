---
id: Ref
title: Ref
---

# Type Alias: Ref\<T, Nullable\>

```ts
type Ref<T, Nullable> = { [K in keyof T]: IsNonExactOptional<T[K]> extends true ? IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNullable<T[K]>> extends true ? Ref<NonNullable<T[K]>, Nullable> | undefined : RefLeaf<NonNullable<T[K]>, Nullable> | undefined : IsPlainObject<NonUndefined<T[K]>> extends true ? Ref<NonUndefined<T[K]>, Nullable> | undefined : RefLeaf<NonUndefined<T[K]>, Nullable> | undefined : IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNull<T[K]>> extends true ? Ref<NonNull<T[K]>, Nullable> | null : RefLeaf<NonNull<T[K]>, Nullable> | null : IsPlainObject<T[K]> extends true ? Ref<T[K], Nullable> : RefLeaf<T[K], Nullable> } & RefLeaf<T, Nullable> & VirtualPropsRef;
```

Defined in: [packages/db/src/query/builder/types.ts:639](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L639)

Ref - The user-facing ref interface for the query builder

This is a clean type that represents a reference to a value in the query,
designed for optimal IDE experience without internal implementation details.
It provides a recursive interface that allows nested property access while
preserving optionality and nullability correctly.

The `Nullable` parameter indicates whether this ref comes from a nullable
join side (left/right/full). When `true`, the `Nullable` flag propagates
through all nested property accesses, ensuring the result type includes
`| undefined` for all fields accessed through this ref.

Includes virtual properties ($synced, $origin, $key, $collectionId) for
querying on sync status and row metadata.

Example usage:
```typescript
// Clean interface - no internal properties visible
const users: Ref<{ id: number; profile?: { bio: string } }> = { ... }
users.id // Ref<number> - clean display
users.profile?.bio // Ref<string> - nested optional access works
users.$synced // RefLeaf<boolean> - virtual property access

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
