---
'@tanstack/db': patch
---

Fix queries failing to typecheck when the collection's row type is a generic type parameter. Refs inside where/join/select callbacks now expose the properties guaranteed by the type parameter's constraint, and subqueries over generic collections can be used as join sources again (regression introduced in 0.6.6).
