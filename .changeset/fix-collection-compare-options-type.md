---
"@tanstack/db": patch
---

Fix Collection interface missing compareOptions property. This resolves a TypeScript error where collections created with `queryCollectionOptions()` (and other collection option functions) were incorrectly reported as missing the `compareOptions` property, even though the property exists at runtime through the `CollectionImpl` class getter.
