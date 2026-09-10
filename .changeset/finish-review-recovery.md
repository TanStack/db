---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/powersync-db-collection': patch
---

Preserve native values, arbitrary class references, and draft cycles during mutation detachment; keep transaction persistence receipts settled after publication errors and avoid restoring an acknowledged direct insert over its server row. Keep a delete/reinsert visible when the old synced row has not yet been replaced.

Retire replaced ordered prefixes without interrupting successful-load bookkeeping if release throws. Retry automatic ordered repair at most twice while retaining stale results and exposing the error; cleanup cancels retries and explicit window retry remains available.

Keep persisted acquisitions independent, avoid retaining one-shot refreshes as permanent demand, and reject upstream load failures without discarding cached rows. Restore PowerSync readiness only after the recovered baseline also removes rows deleted or moved outside active filters during the tracking outage.
