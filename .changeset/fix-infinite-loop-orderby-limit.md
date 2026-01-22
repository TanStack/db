---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
---

Fix infinite loop in ORDER BY + LIMIT queries when WHERE filters out most data.

**The problem**: Query asks for "top 10 where category='rare'" but only 3 rare items exist locally. System keeps asking "give me more!" but local index has nothing else. Loop forever.

**The fix**: Added `localIndexExhausted` flag. When local index says "nothing left," we remember and stop asking. Flag resets when genuinely new data arrives from sync layer.

Also adds safety iteration limits as backstops (D2: 100k, maybeRunGraph: 10k, requestLimitedSnapshot: 10k).
