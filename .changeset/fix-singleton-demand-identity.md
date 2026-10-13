---
'@tanstack/db': patch
---

Share an on-demand Query Collection request when one live query filters by equality and another joined live query requests the same value through singleton membership. These equivalent non-null predicates now use the same demand key.
