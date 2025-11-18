---
"@tanstack/db": patch
---

Fix localStorage collections failing to update/delete items with numeric IDs. Previously, operations would target the wrong item or fail entirely when using numeric IDs (e.g., `id: 1`, `id: 2`) after the page reloaded, due to a type mismatch between numeric keys in memory and stringified keys from localStorage. Numeric keys are now prefixed with `__number__` in storage to ensure consistent lookups.
