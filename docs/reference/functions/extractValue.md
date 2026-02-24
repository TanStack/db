---
id: extractValue
title: extractValue
---

# Function: extractValue()

```ts
function extractValue(expr): any;
```

Defined in: [packages/db/src/query/expression-helpers.ts:127](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L127)

Extracts the value from a Value expression.
Returns undefined for non-value expressions.

## Parameters

### expr

`BasicExpression`

The expression to extract from

## Returns

`any`

The extracted value

## Example

```typescript
const val = extractValue(someExpression)
// Returns: 'electronics'
```
