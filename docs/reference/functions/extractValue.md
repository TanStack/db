---
id: extractValue
title: extractValue
---

```ts
function extractValue(expr): any;
```

Defined in: [packages/db/src/query/expression-helpers.ts:130](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L130)

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
