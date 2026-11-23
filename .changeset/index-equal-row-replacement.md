---
'@tanstack/db': patch
---

Keep indexes and filtered subscriptions current when a sync write replaces a row with a deep-equal one. A reference-valued field such as a `Map` could stay indexed under its old instance, so a later update left a stale entry and ordered reads could repeat one row and omit another. A subscription or live query filtered on such a field by reference now loses or gains the row when its instance is replaced, including through joins, functional filters and filters over a projection. A reader that keeps the row is still told nothing, because its value is unchanged.
