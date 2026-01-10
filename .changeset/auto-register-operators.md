---
'@tanstack/db': patch
---

Refactor operators and aggregates to embed their evaluators directly in IR nodes for true tree-shaking support and custom extensibility.

Each operator and aggregate now bundles its builder function and evaluator factory in a single file. The factory is embedded directly in the `Func` or `Aggregate` IR node, eliminating the need for a global registry. This enables:

- **True tree-shaking**: Only operators/aggregates you import are included in your bundle
- **No global registry**: No side-effect imports needed; each node is self-contained
- **Custom operators**: Create custom operators by building `Func` nodes with a factory
- **Custom aggregates**: Create custom aggregates by building `Aggregate` nodes with a config

**Custom Operator Example:**

```typescript
import {
  Func,
  type EvaluatorFactory,
  type CompiledExpression,
} from '@tanstack/db'
import { toExpression } from '@tanstack/db/query'

const betweenFactory: EvaluatorFactory = (compiledArgs, _isSingleRow) => {
  const [valueEval, minEval, maxEval] = compiledArgs
  return (data) => {
    const value = valueEval!(data)
    return value >= minEval!(data) && value <= maxEval!(data)
  }
}

function between(value: any, min: any, max: any) {
  return new Func(
    'between',
    [toExpression(value), toExpression(min), toExpression(max)],
    betweenFactory,
  )
}
```

**Custom Aggregate Example:**

```typescript
import {
  Aggregate,
  type AggregateConfig,
  type ValueExtractor,
} from '@tanstack/db'
import { toExpression } from '@tanstack/db/query'

const productConfig: AggregateConfig = {
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
  valueTransform: 'numeric',
}

function product<T>(arg: T): Aggregate<number> {
  return new Aggregate('product', [toExpression(arg)], productConfig)
}
```
