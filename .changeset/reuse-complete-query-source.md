---
'@tanstack/query-db-collection': patch
---

A completed, active full-source Query Collection load can now serve later
filtered or windowed live queries when the collection uses a static query key.
The unfiltered on-demand `queryFn` must return the complete source for this
reuse. A default-page response can under-serve those narrower queries.
The narrower queries retain the full Query until their final owner releases,
so the original full view can unmount without dropping their rows or stopping
later invalidation updates. Incomplete full loads and explicit subset refetches
keep their own request paths. Retained persisted ownership is revalidated before
a narrower acquisition settles.
An on-demand load with retained persisted ownership now rejects when an opaque
Query persister result cannot prove source revalidation; the retained row and
marker remain available for a later source-backed request. A manual Query cache
edit during revalidation no longer settles the load before its source fetch
finishes.
An exact snapshot refetch canceled through QueryClient no longer fulfills from
the prior cached result.
