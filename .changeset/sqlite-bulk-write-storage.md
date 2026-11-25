---
'@tanstack/db-sqlite-persistence-core': patch
---

Write large committed transactions to SQLite with less work. A transaction whose replay holds more changes than `pullSinceReloadThreshold` no longer stores that replay: `pullSince` already answered a full reload for it, so it now records the full reload directly instead of keeping a second copy of every row. Row metadata that a transaction sets or clears on a row it also writes is now stored in that row's insert, not in a second pass that rewrote the row. In a Chromium OPFS benchmark, writing 50,000 rows takes about 1.8 s instead of 3.1 s, and 1.7 s instead of 3.9 s when each row's metadata is also cleared.
