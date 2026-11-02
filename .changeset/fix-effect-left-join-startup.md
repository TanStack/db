---
'@tanstack/db': patch
---

Classify Effect deltas from preceding result membership so LEFT-join startup and coalesced source writes emit the correct enter, update, or exit callback, including functional projections with callable or opaque values. Unordered Effects track only result keys and preserve their existing update notifications without comparing or retaining projected values.
