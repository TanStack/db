---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/offline-transactions': patch
---

Preserve fractional top-k replacements regardless of delta order, including left-join updates, and honor B-tree lookup fallbacks after node splits. Preserve own JSON data properties such as `__proto__` during mutation detachment and offline transaction serialization.
