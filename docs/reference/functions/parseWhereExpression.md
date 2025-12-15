---
id: parseWhereExpression
title: parseWhereExpression
---

# Function: parseWhereExpression()

```ts
function parseWhereExpression<T>(expr, options): T | null;
```

Defined in: [packages/db/src/query/expression-helpers.ts:201](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L201)

Parses a WHERE expression into a custom format using provided handlers.

This is the main helper for converting TanStack DB where clauses into your API's filter format.
You provide handlers for each operator, and this function traverses the expression tree
and calls the appropriate handlers.

## Type Parameters

### T

`T` = `any`

## Parameters

### expr

The WHERE expression to parse

`BasicExpression`\<`boolean`\> | `null` | `undefined`

### options

[`ParseWhereOptions`](../../interfaces/ParseWhereOptions.md)\<`T`\>

Configuration with handler functions for each operator

## Returns

`T` \| `null`

The parsed result in your custom format

## Examples

```typescript
// REST API with query parameters
const filters = parseWhereExpression(where, {
  handlers: {
    eq: (field, value) => ({ [field.join('.')]: value }),
    lt: (field, value) => ({ [`${field.join('.')}_lt`]: value }),
    gt: (field, value) => ({ [`${field.join('.')}_gt`]: value }),
    and: (...filters) => Object.assign({}, ...filters),
    or: (...filters) => ({ $or: filters })
  }
})
// Returns: { category: 'electronics', price_lt: 100 }
```

```typescript
// GraphQL where clause
const where = parseWhereExpression(whereExpr, {
  handlers: {
    eq: (field, value) => ({ [field.join('_')]: { _eq: value } }),
    lt: (field, value) => ({ [field.join('_')]: { _lt: value } }),
    and: (...filters) => ({ _and: filters })
  }
})
```
