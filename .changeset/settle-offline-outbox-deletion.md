---
'@tanstack/offline-transactions': patch
---

Wait for acknowledged outbox deletion before reporting a successful offline transaction. Persist fulfilled and permanently rejected provider outcomes so a fresh executor can remove a marked row without calling the provider again. If a phase write or deletion fails, reject the affected caller, stop the executor, and leave queued work untouched. Keep active callers from hanging after manual outbox removal.
