---
id: compileExpression
title: compileExpression
---

# Function: compileExpression()

```ts
function compileExpression(expr, isSingleRow): CompiledSingleRowExpression | CompiledExpression;
```

Defined in: [packages/db/src/query/compiler/evaluators.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/compiler/evaluators.ts#L89)

Compiles an expression into an optimized evaluator function.
This eliminates branching during evaluation by pre-compiling the expression structure.

## Parameters

### expr

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

### isSingleRow

`boolean` = `false`

## Returns

`CompiledSingleRowExpression` \| `CompiledExpression`
