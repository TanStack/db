---
'@tanstack/db': patch
---

Treat `-0` and `0` as distinct row values. A synced update, a replay that replaces a subscription's rows, and an optimistic update that change a field only from `-0` to `0` (or back) now publish a change; before, the Collection could store the new value while subscribers kept the old one. A draft write of `0` over `-0` is now recorded as a change instead of being dropped.
