---
'@tanstack/db': patch
---

fix(query): drive lazy-join loading through the collection the join key resolves to

When a subquery used in a JOIN clause selects its join key from a *joined* source rather than from its own `from` clause, the lazy-join loader subscribed to the wrong inner source: it used the subquery's `from` alias while computing the index requirement against the collection the key actually resolves to. This produced a misleading `Join requires an index` warning naming an already-indexed collection and an unnecessary full-load fallback. `followRef` now reports the resolved source alias, so lazy loading subscribes to the correct collection and loads through its index.
