---
'@tanstack/electric-db-collection': patch
---

Fix awaitMatch race condition on inserts and export isChangeMessage/isControlMessage.

**Bug fixes:**

- Fixed race condition where `awaitMatch` would timeout on inserts when Electric synced faster than the API call
- Messages are now preserved in buffer until next batch arrives, allowing `awaitMatch` to find them
- Added `batchCommitted` flag to track commit state, consistent with `awaitTxId` semantics
- Fixed `batchCommitted` to also trigger on `snapshot-end` in `on-demand` mode (matching "ready" semantics)

**Export fixes:**

- `isChangeMessage` and `isControlMessage` are now exported from the package index as documented
