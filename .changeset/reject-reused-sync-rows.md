---
'@tanstack/db': patch
---

Throw `SyncRowReusedWithoutPreviousValueError` in development when a sync source changes a top-level field of a row object it already wrote and writes it again without `previousValue`. The collection keeps the written object as the stored row, so the in-place change overwrote the previous value, and live queries could keep the row in a filter it left. The check compares shallow copies, so it does not detect a change inside a nested object. Production builds skip the check.
