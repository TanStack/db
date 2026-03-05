---
id: extractSimpleComparisons
title: extractSimpleComparisons
---

# Function: extractSimpleComparisons()

```ts
function extractSimpleComparisons(expr): SimpleComparison[];
```

Defined in: packages/db/src/query/expression-helpers.ts:327

Extracts all simple comparisons from a WHERE expression.
This is useful for simple APIs that only support basic filters.

Note: This only works for simple AND-ed conditions and NOT-wrapped comparisons.
Throws an error if it encounters unsupported operations like OR or complex nested expressions.

NOT operators are flattened by prefixing the operator name (e.g., `not(eq(...))` becomes `not_eq`).

## Parameters

### expr

The WHERE expression to parse

`BasicExpression`\<`boolean`\> | `null` | `undefined`

## Returns

[`SimpleComparison`](../interfaces/SimpleComparison.md)[]

Array of simple comparisons

## Throws

Error if expression contains OR or other unsupported operations

## Example

```typescript
const comparisons = extractSimpleComparisons(where)
// Returns: [
//   { field: ['category'], operator: 'eq', value: 'electronics' },
//   { field: ['price'], operator: 'lt', value: 100 },
//   { field: ['email'], operator: 'isNull' }, // No value for null checks
//   { field: ['status'], operator: 'not_eq', value: 'archived' }
// ]
```
