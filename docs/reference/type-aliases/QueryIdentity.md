---
id: QueryIdentity
title: QueryIdentity
---

# Type Alias: QueryIdentity

```ts
type QueryIdentity = string & object;
```

Defined in: [packages/db/src/query/ir-stable-identity.ts:45](https://github.com/TanStack/db/blob/main/packages/db/src/query/ir-stable-identity.ts#L45)

Semantic identity for a query plan, independent of its runtime owners.

## Type Declaration

### \[queryIdentityBrand\]

```ts
readonly [queryIdentityBrand]: true;
```
