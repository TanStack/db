---
'@tanstack/db': patch
---

Add `subtract`, `multiply`, and `divide` math functions for computed columns

These functions enable complex calculations in `select` and `orderBy` clauses, such as ranking algorithms that combine multiple factors (e.g., HN-style scoring that balances recency and rating).

```ts
import { subtract, multiply, divide } from '@tanstack/db'

// Example: Sort by computed ranking score
const ranked = createLiveQueryCollection((q) =>
  q
    .from({ r: recipesCollection })
    .orderBy(
      ({ r }) =>
        subtract(multiply(r.rating, r.timesMade), divide(r.ageInMs, 86400000)),
      'desc',
    ),
)
```

- `subtract(a, b)` - Subtraction
- `multiply(a, b)` - Multiplication
- `divide(a, b)` - Division (returns `null` on divide-by-zero)
