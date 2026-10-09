---
'@tanstack/db': patch
---

Make LocalStorage persistence receipts wait for accepted writes in order, including un-awaited manual acceptance through DbClient. Synchronize active same-tab Collections that share one Storage object and key, preserve disjoint peer rows and authored native values, and publish clears. Reject malformed restore data and reused options, preserve rows after failed reads, and reconcile custom-parser output before reporting persistence.
