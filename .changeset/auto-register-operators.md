---
'@tanstack/db': patch
---

Refactor operators and aggregates to embed their evaluators directly in IR nodes for true tree-shaking support and custom extensibility.

Each operator and aggregate now bundles its builder function and evaluator factory in a single file. The factory is embedded directly in the `Func` or `Aggregate` IR node, eliminating the need for a global registry. This enables:

- **True tree-shaking**: Only operators/aggregates you import are included in your bundle
- **No global registry**: No side-effect imports needed; each node is self-contained
- **Custom operators**: Use `defineOperator()` to create custom operators
- **Custom aggregates**: Use `defineAggregate()` to create custom aggregates
- **Factory helpers**: Use `comparison()`, `transform()`, `numeric()`, `booleanOp()`, and `pattern()` to easily create operator evaluators

**Custom Operator Example:**

```typescript
import { defineOperator, isUnknown } from '@tanstack/db'

// Define a custom "between" operator
const between = defineOperator<
  boolean,
  [value: number, min: number, max: number]
>({
  name: 'between',
  compile:
    ([valueArg, minArg, maxArg]) =>
    (data) => {
      const value = valueArg(data)
      if (isUnknown(value)) return null
      return value >= minArg(data) && value <= maxArg(data)
    },
})

// Use in a query
query.where(({ user }) => between(user.age, 18, 65))
```

**Using Factory Helpers:**

```typescript
import { defineOperator, comparison, transform, numeric } from '@tanstack/db'

// Binary comparison with automatic null handling
const notEquals = defineOperator<boolean, [a: unknown, b: unknown]>({
  name: 'notEquals',
  compile: comparison((a, b) => a !== b),
})

// Unary transformation
const double = defineOperator<number, [value: number]>({
  name: 'double',
  compile: transform((v) => v * 2),
})

// Binary numeric operation
const modulo = defineOperator<number, [a: number, b: number]>({
  name: 'modulo',
  compile: numeric((a, b) => (b !== 0 ? a % b : null)),
})
```

**Custom Aggregate Example:**

```typescript
import { defineAggregate } from '@tanstack/db'

const product = defineAggregate<number>({
  name: 'product',
  factory: (valueExtractor) => ({
    preMap: valueExtractor,
    reduce: (values) => {
      let result = 1
      for (const [value, multiplicity] of values) {
        for (let i = 0; i < multiplicity; i++) result *= value
      }
      return result
    },
  }),
  valueTransform: 'numeric',
})
```
