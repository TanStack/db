---
id: walkExpression
title: walkExpression
---

# Function: walkExpression()

```ts
function walkExpression(expr, visitor): void;
```

Defined in: [packages/db/src/query/expression-helpers.ts:150](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L150)

Generic expression tree walker that visits each node in the expression.
Useful for implementing custom parsing logic.

## Parameters

### expr

The expression to walk

`BasicExpression`\<`any`\> | `null` | `undefined`

### visitor

(`node`) => `void`

Visitor function called for each node

## Returns

`void`

## Example

```typescript
walkExpression(whereExpr, (node) => {
  if (node.type === 'func' && node.name === 'eq') {
    console.log('Found equality comparison')
  }
})
```
