---
'@tanstack/query-db-collection': patch
'@tanstack/rxdb-db-collection': patch
'@tanstack/powersync-db-collection': patch
'@tanstack/trailbase-db-collection': patch
---

Remove obsolete persisted rows when an eager source's first complete result overlaps SQLite restore. Query Collection also reconciles ownerless saved rows and returned values from initial data, cached results and direct writes while preserving peer ownership, including when an optimistic transaction holds publication. PowerSync preserves its startup batch commits; RxDB preserves its existing source commit. Both delete only restored omissions and retain atomic reload snapshots. RxDB and PowerSync reject incomplete persistence capabilities. TrailBase accepts a sync boundary without the optional metadata API.
