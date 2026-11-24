---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Keep indexes and filtered subscriptions current when a sync write replaces a row with a deep-equal one. A reference-valued field such as a `Map` could stay indexed under its old instance, so a later update left a stale entry and ordered reads could repeat one row and omit another. A subscription or live query filtered on such a field by reference now loses or gains the row when its instance is replaced, including through joins, functional filters, ordered queries, filters over a projection and pooled queries. An ordered query also takes the position of the new instance, and a `distinct` query always shows an instance some row still holds. A reader that keeps the row is still told nothing, because its value is unchanged. A subscriber that buffers a truncate replay also drops a row whose reference left its filter during the replay. A real update between values that hash alike, such as a class and a plain object with the same fields, now reaches ordered queries and joins too.
