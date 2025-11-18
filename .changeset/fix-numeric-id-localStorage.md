---
"@tanstack/db": patch
---

Fix localStorage collections with numeric IDs. Update and delete operations now correctly target items when using numeric IDs. Previously, numeric keys would fail to match after loading from localStorage due to a type mismatch between number keys and JSON's string-only object keys. Numeric keys are now prefixed with `__number__` in storage to prevent collision with string keys (e.g., numeric `1` and string `"1"` no longer collide).
