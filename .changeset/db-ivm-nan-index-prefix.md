---
'@tanstack/db-ivm': patch
---

Fix joins over rows keyed by `NaN`. The index compared row-key prefixes with `===`, which treats `NaN` as unequal to itself, while the `Map` holding the prefixes treats it as one key. A retracted `NaN`-keyed row then never cancelled, so the join published a duplicate row or threw `Mismatching prefixes`.
