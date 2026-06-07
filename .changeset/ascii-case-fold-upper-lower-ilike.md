---
"@tanstack/db": patch
---

Use ASCII-only case fold in `upper()`, `lower()`, and `ilike` to avoid JavaScript's locale-aware and length-changing `toUpperCase()` / `toLowerCase()`.

`'straße'.toUpperCase()` is `'STRASSE'` (six characters become seven). `'İ'.toLowerCase()` becomes `'i̇'` (one character becomes two, adding a combining mark). `'I'.toLowerCase()` under a Turkish locale returns `'ı'` instead of `'i'`. These length-changing and locale-dependent folds caused TanStack DB's evaluator to silently disagree with the server side of a query collection when the source data contained non-ASCII characters - rows would drop out of the matching set with no error.

`upper()` and `lower()` now match SQLite's default ASCII-only fold, so they are deterministic across JS locales and length-preserving. `ilike` uses the same ASCII fold for its case-insensitive comparison.

For full Unicode-aware case folding, users can apply `String.prototype.toUpperCase()` / `toLowerCase()` themselves in a JavaScript expression before the value reaches the query layer.
