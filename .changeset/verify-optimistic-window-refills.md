---
'@tanstack/db': patch
---

Publish optimistic membership departures from ordered live-query windows immediately, even when a provider refill is pending. Keep provider-backed rows private until their sync writes apply.
