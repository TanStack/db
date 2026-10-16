---
'@tanstack/db': patch
---

Keep an ordered live query loading when a request that a bounded repair superseded fails after the repair finished. The failure no longer blocks refills until a window move. The loader recovers with one full-source read.
