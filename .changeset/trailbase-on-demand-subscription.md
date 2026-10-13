---
'@tanstack/trailbase-db-collection': patch
---

An on-demand TrailBase load now waits for the change subscription before it fetches rows. Before, a live query could become ready before the subscription started, and a change committed after the fetch but before the subscription was lost.
