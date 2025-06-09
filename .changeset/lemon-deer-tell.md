---
"@tanstack/db": patch
---

the select operator is not optional on a query, it will default to returning the whole row for a basic query, and a namespaced object when there are joins
