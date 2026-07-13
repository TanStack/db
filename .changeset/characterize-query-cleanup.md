---
'@tanstack/query-db-collection': patch
---

Fix temporary query readiness listeners so subset unload and collection cleanup release them correctly during in-flight requests.
