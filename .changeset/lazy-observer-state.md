---
'@tanstack/db': patch
---

Build a live query snapshot's keyed `state` map only when code first reads it. A consumer that reads only `data`, as most `useLiveQuery` callers do, no longer pays for a second copy of the results on each update. A retained snapshot still shows the rows from the time it was built.
