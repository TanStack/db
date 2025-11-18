---
"@tanstack/db": patch
---

Fix localStorage collections with numeric IDs. Update and delete operations now correctly target items when using numeric IDs instead of string IDs. Previously, numeric keys would fail to match after loading from localStorage due to a type mismatch between number keys and JSON's string-only object keys.
