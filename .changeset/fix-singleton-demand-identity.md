---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Share an on-demand Query Collection request when one live query filters by equality and another joined live query requests the same value through singleton membership. These equivalent non-null predicates now use the same demand key.

Keep distinct reference-proxy values separate when they occur inside literal equality operands or IN lists. Query keys for non-null singleton IN requests change in this release. When a matching demand runs, persisted Query Collections revalidate and retire historical owners and retention markers, including owners left without markers by an interrupted process. A historical reference-proxy key can name different literal objects with the same path. Revalidating a matching proxy demand retires that ambiguous old key after the new result applies; a failed fetch preserves it.
