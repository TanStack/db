---
'@tanstack/db-ivm': patch
---

Joins and reductions do less work per changed key. `Index.get` builds its result array directly instead of spreading a generator. A reduce operator's indexes no longer keep the per-key presence count, which only joins read; reading presence from such an index now throws instead of returning a wrong answer. A reduce whose key has at most one output before and after compares the two directly instead of building two maps. Live queries with includes hydrate about 5–9% faster.
