---
'@tanstack/electric-db-collection': patch
---

Preserve typed filtering, ordering, mapped fields, and distinct null/missing
semantics when Electric subset queries reference nested JSON properties.

Compile scalar membership against PostgreSQL and nested JSON arrays with the
correct containment direction, while rejecting nullish operands and
literal-array left operands that cannot represent scalar membership.
