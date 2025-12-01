---
"@tanstack/db": patch
---

Add auto-registering operators for tree-shaking support and custom operator extensibility.

Each operator now bundles its builder function and evaluator in a single file, registering itself when imported. This enables:

- **Tree-shaking**: Only operators you import are included in your bundle
- **Custom operators**: Use `registerOperator()` to add your own operators

```typescript
import { registerOperator, type EvaluatorFactory } from '@tanstack/db'

// Create a custom "between" operator
registerOperator('between', (compiledArgs, _isSingleRow) => {
  const [valueEval, minEval, maxEval] = compiledArgs
  return (data) => {
    const value = valueEval!(data)
    return value >= minEval!(data) && value <= maxEval!(data)
  }
})
```
