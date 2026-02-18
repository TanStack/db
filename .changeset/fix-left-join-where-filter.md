---
'@tanstack/db': patch
---

fix(db): don't push WHERE clauses to nullable side of outer joins

The query optimizer incorrectly pushed single-source WHERE clauses into subqueries and collection index optimization for the nullable side of outer joins. This pre-filtered the data before the join, converting rows that should have been excluded by the WHERE into unmatched outer-join rows that incorrectly survived the residual filter.
