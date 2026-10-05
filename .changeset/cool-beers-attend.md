---
'@tanstack/db': minor
---

Add support for compound join conditions using `and()`

Joins can now use multiple equality conditions combined with `and()`:

```
.join(
  { inventory: inventoriesCollection },
  ({ product, inventory }) =>
    and(
      eq(product.region, inventory.region),
      eq(product.sku, inventory.sku)
    )
)
```

Every equality uses the existing join value semantics, including nullish
non-matching behavior. Compound joins support nested `and()` expressions,
independently reversed operands, correlated includes, and lazy source loading.

The low-level `JoinClause` IR now stores the complete predicate in `on` instead
of separate `left` and `right` operands. Code constructing IR directly should
use `on: new Func('eq', [left, right])` for a single equality.
