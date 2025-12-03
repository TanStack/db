---
"@tanstack/db": patch
---

fix(db): compile filter expression once in createFilterFunctionFromExpression

Fixed a performance issue in `createFilterFunctionFromExpression` where the expression was being recompiled on every filter call. This only affected realtime change event filtering for pushed-down predicates at the collection level when using orderBy + limit. The core query engine was not affected as it already compiled predicates once.
