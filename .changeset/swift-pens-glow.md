---
"@tanstack/db": patch
---

Fix asymmetric behavior in `deepEquals` when comparing different special types (Date, RegExp, Map, Set, TypedArray, Temporal, Array). Previously, comparing values like `deepEquals(Date, Temporal.Duration)` could return a different result than `deepEquals(Temporal.Duration, Date)`. Now both directions correctly return `false` for mismatched types, ensuring `deepEquals` is a proper equivalence relation.
