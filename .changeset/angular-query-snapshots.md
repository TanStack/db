---
'@tanstack/angular-db': major
---

Require Angular 20 or later. Keep live-query result signals coherent with the current query before effects run, and release observer subscriptions through effect cleanup. Track the observer's row-state identity separately so unchanged row state does not rebuild the adapter's defensive Map copy.
