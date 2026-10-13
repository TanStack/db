---
'@tanstack/query-db-collection': patch
---

A completed, active full-source Query Collection load can now serve later
filtered or windowed live queries when the collection uses a static query key.
The narrower queries retain the full Query until their final owner releases,
so the original full view can unmount without dropping their rows or stopping
later invalidation updates. Incomplete full loads and explicit subset refetches
keep their own request paths. A narrower scope with retained persisted ownership
makes an exact request to revalidate its rows and owners.
