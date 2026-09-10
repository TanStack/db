---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/powersync-db-collection': patch
---

Preserve native values, arbitrary class references, and draft cycles during mutation detachment; keep transaction persistence receipts settled after publication errors and avoid restoring an acknowledged direct insert over its server row.

Retire replaced ordered prefixes and retry automatic ordered repair at most twice while retaining stale results and exposing the error; cleanup cancels retries and explicit window retry remains available.

Keep persisted acquisitions independent, reject upstream load failures without discarding cached rows, and restore PowerSync readiness after a successful tracking rebuild and applied baseline.
