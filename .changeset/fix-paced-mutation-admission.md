---
'@tanstack/db': patch
---

Reject paced queue overflow transactions with optimistic rollback, preserve caller-owned strategy options, and wait for the first trailing edge when throttle leading execution is disabled.
Queue cleanup stops new admission and drains admitted work in order.
