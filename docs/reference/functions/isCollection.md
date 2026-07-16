---
id: isCollection
title: isCollection
---

# Function: isCollection()

```ts
function isCollection(value): value is Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>;
```

Defined in: [packages/db/src/live-query-adapter.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-adapter.ts#L22)

Structural check for a live-query/`Collection` instance.

Uses duck typing rather than `instanceof CollectionImpl` on purpose: adapters
and core can resolve to different copies of `@tanstack/db` (dual-package /
multi-realm), where `instanceof` gives false negatives. The three methods
below uniquely identify a Collection.

## Parameters

### value

`unknown`

## Returns

`value is Collection<any, any, any, StandardSchemaV1<unknown, unknown>, any>`
