---
"@tanstack/db": patch
---

Make transaction commit() method throw errors instead of swallowing them

Previously, when a transaction's mutationFn threw an error, the commit() method would catch it, rollback the transaction, and return the failed transaction instead of re-throwing the error. This made it inconsistent with the documented error handling patterns.

Now commit() properly re-throws errors after rolling back, allowing both `await tx.commit()` and `await tx.isPersisted.promise` to work correctly in try/catch blocks as shown in the documentation.
