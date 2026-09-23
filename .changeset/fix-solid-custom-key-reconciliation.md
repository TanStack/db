---
'@tanstack/solid-db': patch
---

Keep Solid live-query rows tied to their result identities when custom-key rows
reorder or multiple results share the same public `$key`.
