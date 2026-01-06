---
"@tanstack/db": patch
---

Add detection and error messages for JavaScript operators in query callbacks

This adds helpful error messages when users mistakenly use JavaScript operators (`||`, `&&`, `??`, `?:`) in query callbacks. These operators are evaluated at query construction time rather than execution time, causing silent unexpected behavior.

Changes:
- Add `JavaScriptOperatorInQueryError` with helpful suggestions for alternatives
- Add `Symbol.toPrimitive` trap to `RefProxy` to catch primitive coercion attempts
- Add `checkCallbackForJsOperators()` to detect operators in callback source code
- Integrate checks into `select()`, `where()`, and `having()` methods
