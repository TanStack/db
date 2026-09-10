---
'@tanstack/db': patch
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/electric-db-collection': patch
---

Harden Electric resume and lifecycle handling so partial updates cannot materialize unknown or moved-out rows, stale async work and waiters cannot cross cleanup or restart—including automatic garbage collection—and valid batches behave the same across callback partitions and persistence hydration.

Preserve hydrated baseline rows during persistence reloads, accept complete-row updates from explicit full-replica resumes, retain committed match evidence until reset, and restart persisted resumes when hydration completion cannot be verified.

Replace stale cached rows atomically when an invalid resume falls back to a fresh snapshot. Keep subset acquisitions from restoring logically removed rows, and isolate utilities and tag visibility when collection options are reused while preserving compatible same-collection resume state.

Accept partial updates to complete rows published independently by persistence, while preserving pending removal and reset boundaries. Avoid copying all applied keys at startup or each subset acquisition; presence checks overlay queued writes and buffered messages once per stream callback. Warn once when an older persistence adapter cannot verify hydration for safe resume.
