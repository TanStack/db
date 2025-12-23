---
'@tanstack/db': patch
---

Add support for delete-then-insert on the same record within a transaction, enabling undo workflows by either canceling both mutations (if data matches) or converting to an update.
