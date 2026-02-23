---
id: parseOrderByExpression
title: parseOrderByExpression
---

# Function: parseOrderByExpression()

```ts
function parseOrderByExpression(orderBy): ParsedOrderBy[];
```

Defined in: packages/db/src/query/expression-helpers.ts:265

Parses an ORDER BY expression into a simple array of sort specifications.

## Parameters

### orderBy

The ORDER BY expression array

[`OrderBy`](../@tanstack/namespaces/IR/type-aliases/OrderBy.md) | `null` | `undefined`

## Returns

[`ParsedOrderBy`](../interfaces/ParsedOrderBy.md)[]

Array of parsed order by specifications

## Example

```typescript
const sorts = parseOrderByExpression(orderBy)
// Returns: [
//   { field: ['category'], direction: 'asc', nulls: 'last' },
//   { field: ['price'], direction: 'desc', nulls: 'last' }
// ]
```
