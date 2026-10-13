---
'@tanstack/db': patch
---

A live query now recovers when a source Collection errors and then becomes ready again. Before, a subset load that rejected because its source entered `error` put a query with a join or include into a terminal error, and a direct query became ready on recovery without loading its subset again. The load is now requested again when the source recovers, and the query becomes ready when that load settles. A load that rejects while its source is healthy still puts the query in error.
