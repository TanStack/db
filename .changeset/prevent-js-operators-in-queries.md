---
'@tanstack/db': patch
---

Add development warnings for JavaScript operators in query callbacks

Warns developers when they mistakenly use JavaScript operators (`||`, `&&`, `??`, `?:`) in query callbacks. These operators are evaluated at query construction time rather than execution time, causing silent unexpected behavior.

Changes:

- Add `Symbol.toPrimitive` trap to RefProxy to catch primitive coercion (throws error)
- Add `checkCallbackForJsOperators()` to detect operators in callback source code (warns in dev only)
- Integrate checks into `select()`, `where()`, and `having()` methods
- Detection is disabled in production mode for zero runtime overhead
