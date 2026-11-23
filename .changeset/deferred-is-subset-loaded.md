---
'@tanstack/db': patch
---

Add an optional `isSubsetLoaded` sync hook, so a live query with no subscriber yet can publish a window whose rows the source already holds on its first frame.
