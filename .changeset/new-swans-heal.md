---
"@tanstack/db": patch
---

fix a race condition that could result in the initial state of a joined collection being sent to the live query pipeline twice, this would result in incorrect join results.
