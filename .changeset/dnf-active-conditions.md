---
'@tanstack/electric-db-collection': minor
---

feat: add DNF/active_conditions support for arbitrary boolean WHERE clauses

Support the new Electric server wire protocol (electric-sql/electric#3791). Tags now use `/` delimiter with empty segments for non-participating positions. Shapes with subquery dependencies send `active_conditions` headers and use DNF evaluation for row visibility. Simple shapes without subqueries retain existing empty-tag-set deletion behavior.
