---
id: compileExpression
title: compileExpression
---

```ts
function compileExpression(expr, isSingleRow): CompiledExpression | CompiledSingleRowExpression;
```

Defined in: [packages/db/src/query/compiler/evaluators.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/query/compiler/evaluators.ts#L103)

Compiles an expression into an optimized evaluator function.
This eliminates branching during evaluation by pre-compiling the expression structure.

## Parameters

### expr

[`BasicExpression`](../@tanstack/namespaces/IR/type-aliases/BasicExpression.md)

### isSingleRow

`boolean` = `false`

## Returns

`CompiledExpression` \| `CompiledSingleRowExpression`
