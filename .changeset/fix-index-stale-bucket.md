---
'@tanstack/db': patch
---

fix(db): prevent indexes from leaving a key in two buckets at once

`BasicIndex` and `BTreeIndex` now track each key's currently-indexed value internally and use that on `remove`/`update`, instead of trusting the caller-supplied `oldItem`. If `oldItem` evaluated to a value that didn't match the bucket the key actually lived in, the previous implementation silently no-oped on the bucket map while the subsequent `add` placed the key in a new bucket, leaving the key in two buckets simultaneously. Calling `add` for a key that's already indexed also now drops the previous bucket first, so a missed `remove` can't double-bucket the key.

This was the underlying cause of stale auto-index buckets after an optimistic→synced update on the indexed column (e.g. a kanban card snapping back to its old column).
