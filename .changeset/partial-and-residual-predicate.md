---
"@tanstack/db": patch
---

fix(db): re-evaluate unindexed AND branches as a residual predicate against the indexed candidate set

`optimizeAndExpression` previously returned the intersection of only the index-optimizable branches and treated those keys as exact matches. With one or more branches lacking an index, the caller emitted rows that did not actually satisfy those branches — a soundness bug.

`OptimizationResult` now carries an optional `residualPredicate`. When set, the caller in `currentStateAsChanges` evaluates it against each candidate key and drops rows that fail. This restores correctness for partial AND optimization while keeping the index-narrowed candidate set (~120× faster than full scan in the included benchmark).

OR optimization remains strict: an unindexed OR branch can match any row, so partial OR cannot be made sound without a full scan and is rejected.
