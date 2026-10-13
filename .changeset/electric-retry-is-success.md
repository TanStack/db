---
'@tanstack/electric-db-collection': patch
---

A stream error that `onError` retries no longer fails the initial sync or the subset loads that are waiting for it. The collection stays `loading` while `onError` decides, and waiting loads settle when the retried stream delivers its snapshot. Before, the collection entered `error` and waiting loads rejected even when the retry succeeded, which could leave a joined or included live query in error for good. A stream error without `onError`, or one where `onError` gives up or throws, still fails the initial sync and its waiting loads.
