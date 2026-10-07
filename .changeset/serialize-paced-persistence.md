---
'@tanstack/db': patch
---

Keep paced mutation persistence serial while a backend write is pending, including after a manual rollback. Preserve admitted optimistic updates and reject dropped calls without canceling other work.
Restore a transaction's prior optimistic changes when a synchronous `mutate` callback throws, and keep debounce and throttle leading writes available after failed admission.
