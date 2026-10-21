---
'@tanstack/query-db-collection': patch
---

Keep a reacquired Query's cached rows when an earlier release of the same Query publishes later. Previously, reacquiring a stale on-demand Query while its release waited behind another sync transaction could drop its rows, and they stayed missing if the refetch failed.
