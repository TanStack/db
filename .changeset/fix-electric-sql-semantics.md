---
'@tanstack/electric-db-collection': patch
---

Preserve PostgreSQL semantics for boolean comparisons and array membership,
including nullable values, compatible reference-to-array types, and non-text
array elements. Reject nullish membership operands and literal-array left
operands, and escape quotes in mapped column names.
