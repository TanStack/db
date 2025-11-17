---
"@tanstack/db": patch
---

Fix Collection compareOptions type error. This resolves a TypeScript error where collections created with `queryCollectionOptions()` (and other collection option functions) were incorrectly reported as missing the `compareOptions` property. The fix converts `compareOptions` from a getter to a public readonly property in the `CollectionImpl` class, ensuring proper type resolution with TypeScript's `Pick` utility.
