---
"@tanstack/db": minor
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
