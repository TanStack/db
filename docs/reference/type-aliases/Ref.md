---
id: Ref
title: Ref
---

# Type Alias: Ref\<T, Nullable\>

```ts
type Ref<T, Nullable> = { [K in keyof T]: IsNonExactOptional<T[K]> extends true ? IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNullable<T[K]>> extends true ? Ref<NonNullable<T[K]>, Nullable> | undefined : RefLeaf<NonNullable<T[K]>, Nullable> | undefined : IsPlainObject<NonUndefined<T[K]>> extends true ? Ref<NonUndefined<T[K]>, Nullable> | undefined : RefLeaf<NonUndefined<T[K]>, Nullable> | undefined : IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNull<T[K]>> extends true ? Ref<NonNull<T[K]>, Nullable> | null : RefLeaf<NonNull<T[K]>, Nullable> | null : IsPlainObject<T[K]> extends true ? Ref<T[K], Nullable> : RefLeaf<T[K], Nullable> } & RefLeaf<T, Nullable>;
```

Defined in: [packages/db/src/query/builder/types.ts:502](https://github.com/TanStack/db/blob/main/packages/db/src/query/builder/types.ts#L502)

Ref - The user-facing ref interface for the query builder

This is a clean type that represents a reference to a value in the query,
designed for optimal IDE experience without internal implementation details.
It provides a recursive interface that allows nested property access while
preserving optionality and nullability correctly.

The `Nullable` parameter indicates whether this ref comes from a nullable
join side (left/right/full). When `true`, the `Nullable` flag propagates
through all nested property accesses, ensuring the result type includes
`| undefined` for all fields accessed through this ref.

Example usage:
```typescript
// Non-nullable ref (inner join or from table):
select(({ user }) => ({ name: user.name })) // result: string

// Nullable ref (left join right side):
select(({ dept }) => ({ name: dept.name })) // result: string | undefined

// Spread operations work cleanly:
select(({ user }) => ({ ...user })) // Returns User type, not Ref types
```

## Type Parameters

### T

`T` = `any`

### Nullable

`Nullable` *extends* `boolean` = `false`
