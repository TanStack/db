---
'@tanstack/offline-transactions': patch
---

Remove the no-op telemetry wrappers that remained after telemetry was removed. No behavior change is intended. Some operations can settle in fewer microtasks because the wrappers no longer add awaits.
