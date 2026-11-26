---
'@tanstack/db': patch
---

Add an optional `isSubsetLoaded` sync hook, so a live query with no subscriber yet can publish a window whose rows the source already holds on its first frame.

A joined filter's first ordered request also waits for pending joined work, and a synchronously answered request whose refill waits on joined work returns instead of spinning.
