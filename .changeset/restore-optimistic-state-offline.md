---
'@tanstack/offline-transactions': patch
---

Fix optimistic state not being restored to collections on page refresh while offline. Pending transactions are now automatically rehydrated from storage and their optimistic mutations applied to the UI immediately on startup, providing a seamless offline experience.
