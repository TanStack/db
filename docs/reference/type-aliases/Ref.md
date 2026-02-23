---
id: Ref
title: Ref
---

# Type Alias: Ref\<T\>

```ts
type Ref<T> = { [K in keyof T]: IsNonExactOptional<T[K]> extends true ? IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNullable<T[K]>> extends true ? Ref<NonNullable<T[K]>> | undefined : RefLeaf<NonNullable<T[K]>> | undefined : IsPlainObject<NonUndefined<T[K]>> extends true ? Ref<NonUndefined<T[K]>> | undefined : RefLeaf<NonUndefined<T[K]>> | undefined : IsNonExactNullable<T[K]> extends true ? IsPlainObject<NonNull<T[K]>> extends true ? Ref<NonNull<T[K]>> | null : RefLeaf<NonNull<T[K]>> | null : IsPlainObject<T[K]> extends true ? Ref<T[K]> : RefLeaf<T[K]> } & RefLeaf<T>;
```

Defined in: packages/db/src/query/builder/types.ts:496

Ref - The user-facing ref interface for the query builder

This is a clean type that represents a reference to a value in the query,
designed for optimal IDE experience without internal implementation details.
It provides a recursive interface that allows nested property access while
preserving optionality and nullability correctly.

When spread in select clauses, it correctly produces the underlying data type
without Ref wrappers, enabling clean spread operations.

Example usage:
```typescript
// Clean interface - no internal properties visible
const users: Ref<{ id: number; profile?: { bio: string } }> = { ... }
users.id // Ref<number> - clean display
users.profile?.bio // Ref<string> - nested optional access works

// Spread operations work cleanly:
select(({ user }) => ({ ...user })) // Returns User type, not Ref types
```

## Type Parameters

### T

`T` = `any`
