---
'@tanstack/db': patch
---

Classify Effect deltas from preceding result membership so LEFT-join startup and coalesced source writes emit the correct enter, update, or exit callback, including functional projections with callable or opaque values. Suppress updates when the projected result remains equal under change-event equality, and avoid that comparison when no update or batch handler observes it.

Avoid factorial comparison work, redundant ancestor-map copies, and recursive member matching for object Sets. Preserve one-to-one matching while taking a direct path for aligned members.
