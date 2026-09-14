---
'@tanstack/electric-db-collection': patch
---

Preserve nested boolean predicate grouping when compiling Electric subset SQL,
including comparison results and NOT expressions used inside comparisons,
membership checks, and null tests.
