---
'@tanstack/db': patch
'@tanstack/query-db-collection': patch
---

Share an on-demand Query Collection request when one live query filters by equality and another joined live query requests the same value through singleton membership. These equivalent non-null predicates now use the same demand key.

Keep distinct reference-proxy values separate when they occur inside literal equality operands or IN lists. Query keys for non-null singleton IN requests change in this release. Query Collections revalidate and migrate retained primitive-literal singleton IN owners and markers from the previous key when that demand is reacquired. Old reference-proxy keys cannot be migrated safely because their former encoding can collide with row-reference queries; they follow their configured retention policy, including indefinite retention under `until-revalidated`.
