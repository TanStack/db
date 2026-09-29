---
'@tanstack/db': patch
---

Reject queue overflow and post-cleanup calls with accurate errors and optimistic rollback. Drain pending queue, debounce, and throttle work on cleanup, and preserve caller-owned strategy options. Settle debounce and throttle calls across supported edge options, including throttle epoch zero, and reject calls intentionally dropped by disabled trailing execution.
