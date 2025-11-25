---
"@tanstack/db": patch
---

Fix scheduler handling of lazy left-join/live-query dependencies: treat non-enqueued lazy deps as satisfied to avoid unresolved-dependency deadlocks, and block only when a dep actually has pending work.
