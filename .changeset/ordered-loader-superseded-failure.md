---
'@tanstack/db': patch
---

Keep an ordered live query loading when work overlaps a bounded repair. A request that a repair superseded no longer blocks refills when it fails; the loader recovers with one full-source read and then releases the failed request. A repair that answers at once no longer waits behind the older request, a failing request no longer drops the repair's next step, and a throwing release inside a window move no longer stops the repair. A page whose own delivery changes the order no longer counts as current, so the repair releases the tie it led to.
