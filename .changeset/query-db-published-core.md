---
'@tanstack/query-db-collection': patch
---

Keep a shared Query's provider signal live while another Collection acquisition owns it, and require an applied full-source result before reusing it for a narrower demand. Release the physical Query chosen by each acquisition when equal demands route differently after a failed full refresh or an explicit exact refetch. Order overlapping fetched row values by query-function invocation when cache callbacks start another Query first. Let a fresh server response replace an older persisted direct value after the original Collection acquisition releases. Remove observers and tracked Query cache entries when explicit Collection cleanup runs during a synchronous fetch notification.

Keep signal-free `loadSubsetOptions` cloneable and free of an enumerable signal property when passed to a query function.

Keep row ownership aligned with the active acquisition when a final release occurs during result application or synchronously starts a replacement acquisition. A replacement waits for an aborted but still-open commit before it applies the same Query result.
