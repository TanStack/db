---
"@tanstack/db": patch
---

Fix bulk insert not detecting duplicate keys within the same batch. Previously, when inserting multiple items with the same key in a single bulk insert operation, later items would silently overwrite earlier ones. Now, a `DuplicateKeyError` is thrown when duplicate keys are detected within the same batch.
