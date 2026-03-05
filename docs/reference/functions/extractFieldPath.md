---
id: extractFieldPath
title: extractFieldPath
---

# Function: extractFieldPath()

```ts
function extractFieldPath(expr): FieldPath | null;
```

Defined in: packages/db/src/query/expression-helpers.ts:107

Extracts the field path from a PropRef expression.
Returns null for non-ref expressions.

## Parameters

### expr

`BasicExpression`

The expression to extract from

## Returns

[`FieldPath`](../type-aliases/FieldPath.md) \| `null`

The field path array, or null

## Example

```typescript
const field = extractFieldPath(someExpression)
// Returns: ['product', 'category']
```
