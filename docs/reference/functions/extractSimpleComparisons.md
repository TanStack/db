---
id: extractSimpleComparisons
title: extractSimpleComparisons
---

# Function: extractSimpleComparisons()

```ts
function extractSimpleComparisons(expr): SimpleComparison[];
```

Defined in: [packages/db/src/query/expression-helpers.ts:323](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L323)

Extracts all simple comparisons from a WHERE expression.
This is useful for simple APIs that only support basic filters.

Note: This only works for simple AND-ed conditions. Throws an error if it encounters
unsupported operations like OR, NOT, or complex nested expressions.

## Parameters

### expr

The WHERE expression to parse

`BasicExpression`\<`boolean`\> | `null` | `undefined`

## Returns

[`SimpleComparison`](../../interfaces/SimpleComparison.md)[]

Array of simple comparisons

## Throws

Error if expression contains OR, NOT, or other unsupported operations

## Example

```typescript
const comparisons = extractSimpleComparisons(where)
// Returns: [
//   { field: ['category'], operator: 'eq', value: 'electronics' },
//   { field: ['price'], operator: 'lt', value: 100 }
// ]
```
