---
'@tanstack/db': patch
---

Local-only Collections apply direct `insert`, `update`, and `delete` calls without an optimistic stage when no user handler is configured for that operation and no other transaction on the Collection is pending or persisting. The write is published once, and the returned transaction is already `completed` with `isPersisted.promise` resolved. Writes inside an ambient transaction, with a handler, or beside another unsettled transaction behave as before.
