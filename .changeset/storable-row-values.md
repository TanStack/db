---
'@tanstack/db': patch
---

LocalStorage Collections with the default JSON parser now reject an insert or update whose row a restore could not return, such as a row with a function, symbol, `NaN`, `Map`, `Set`, or `undefined` array entry. The write's `isPersisted` promise rejects with `SerializationError`, nothing is written, and the optimistic row rolls back. Previously, JSON silently dropped or replaced these values, so peers and later sessions saw a different row than the writer.

IndexedDB Collections now report a value that structured clone cannot store as `SerializationError` instead of a raw `DataCloneError`. The `SerializationError` message no longer says "JSON".
