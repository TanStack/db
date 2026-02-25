---
'@tanstack/offline-transactions': patch
---

Fix retry behavior to not cap at 10 attempts and not burn retries while offline. Default retry policy now retries indefinitely with exponential backoff. Execution loop and retry timer check online status before attempting transactions. `OnlineDetector.isOnline()` is now a required method on the interface.
