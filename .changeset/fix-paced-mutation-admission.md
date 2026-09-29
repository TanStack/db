---
'@tanstack/db': patch
---

Reject queue overflow and post-cleanup calls with accurate errors and optimistic rollback. Drain admitted queue and throttle work on cleanup, and preserve caller-owned strategy options. Settle throttle calls across supported edge options, including epoch zero, and reject calls intentionally dropped by disabled trailing execution.
