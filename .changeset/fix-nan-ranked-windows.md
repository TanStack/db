---
'@tanstack/db': patch
---

Fix live queries that order numeric NaN values in descending windows. Equal NaN values no longer cause a contributor-congruence error.
