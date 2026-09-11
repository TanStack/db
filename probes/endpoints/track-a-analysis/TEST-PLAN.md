# Pre-implementation test contract

1. Export a separately constructed Drizzle Todo builder to exact parameterized SQL; retain selected-field and authored-schema evidence. This alone cannot count as handler extraction.
2. Parse a source fixture without importing it. Accept only direct single-table fluent selection, equality predicate and ascending column order, followed by direct res.json(todos). Preserve spans for selection, predicate, order and response. Unknown helpers, joins, branches and response transforms return explicit not-checked reasons.
3. Execute generated SQL against disposable PostgreSQL, query pg_index/pg_attribute, and require valid unconditional single-column non-null uniqueness matching authored schema before supporting id as a result key. createdAt alone fails total order; append id at authored orderBy span and rerun parser, export and semantic check.
4. Concrete SQL witnesses: join repeats IDs, nullable unique accepts two nulls, partial unique permits duplicate IDs outside its condition, deployed table lacking source primary key does not pass. These must never be supported by the narrow classifier.
5. Output exact tool/library/database versions, results, source hashes and diagnostic location/edit. Unknown grammar is not a successful proof. No claim of UI order, all possible JavaScript branches, schema deployment identity, or integrated Todo behavior.
