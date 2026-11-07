---
'@tanstack/db': patch
---

Hydrate a disabled live query without waiting for a server record. The server never streams a record for a query whose callback returns `undefined`, so the browser hydration read no longer suspends on it and no longer throws error 253 after the DB stream ends.
