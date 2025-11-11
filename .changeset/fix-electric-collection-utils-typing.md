---
"@tanstack/electric-db-collection": patch
---

Fix incorrect typing of `collection.utils` in Electric collection mutation callbacks. Previously, `collection.utils` was typed as the generic `UtilsRecord` instead of `ElectricCollectionUtils<T>`, preventing type-safe access to `awaitTxId` and `awaitMatch` utility methods within `onInsert`, `onUpdate`, and `onDelete` handlers.
