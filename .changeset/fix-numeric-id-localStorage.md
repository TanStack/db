---
"@tanstack/db": patch
---

Fix localStorage collections to properly handle numeric and string IDs without collisions. Previously, operations could target the wrong item when using numeric IDs (e.g., `id: 1`, `id: 2`) after the page reloaded, due to a type mismatch between numeric keys in memory and stringified keys from localStorage. Keys are now encoded with type prefixes (`n:` for numbers, `s:` for strings) to prevent all possible collisions between different key types.
