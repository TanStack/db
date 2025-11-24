---
"@tanstack/db-ivm": patch
"@tanstack/db": patch
---

Fix joining collections by small Uint8Array keys to use content-based comparison instead of reference equality.

Previously, when joining collections using Uint8Array keys (like ULIDs or UUIDs), the Index class would compare keys by reference rather than by content. This caused joins to fail when the same byte array data existed in separate instances.

This fix introduces shared Uint8Array normalization utilities that convert small Uint8Arrays (≤128 bytes) to string representations for content-based equality checking. The normalization logic is now shared between `db-ivm` and `db` packages, eliminating code duplication.

Fixes #896
