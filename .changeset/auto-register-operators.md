---
"@tanstack/db": patch
---

Add auto-registering operators and aggregates for tree-shaking support and custom extensibility.

Each operator and aggregate now bundles its builder function and evaluator in a single file, registering itself when imported. This enables:

- **Tree-shaking**: Only operators/aggregates you import are included in your bundle
- **Custom operators**: Use `registerOperator()` to add your own operators
- **Custom aggregates**: Use `registerAggregate()` to add your own aggregate functions

**Custom Operator Example:**

```typescript
import { registerOperator, type EvaluatorFactory } from "@tanstack/db"

registerOperator("between", (compiledArgs, _isSingleRow) => {
  const [valueEval, minEval, maxEval] = compiledArgs
  return (data) => {
    const value = valueEval!(data)
    return value >= minEval!(data) && value <= maxEval!(data)
  }
})
```

**Custom Aggregate Example:**

```typescript
import { registerAggregate, type ValueExtractor } from "@tanstack/db"

// Custom "product" aggregate that multiplies values
registerAggregate("product", {
  factory: (valueExtractor: ValueExtractor) => ({
    preMap: valueExtractor,
    reduce: (values) => {
      let product = 1
      for (const [value, multiplicity] of values) {
        for (let i = 0; i < multiplicity; i++) product *= value
      }
      return product
    },
  }),
  valueTransform: "numeric",
})
```
