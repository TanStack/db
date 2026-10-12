---
'@tanstack/db': patch
---

Rolling back a transaction that has no mutations no longer causes an unhandled promise rejection. Such a transaction is tracked by no Collection, so nothing else observed its receipt, and Node reported the rejection. Every transaction now marks its receipt as observed when it is created. A caller that reads `when('settled')` still receives the rejection.
