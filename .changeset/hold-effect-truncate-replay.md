---
'@tanstack/db': patch
---

Keep live query Effect callbacks behind the truncate replay when it starts as a subset acquisition completes. For Effects with `skipInitial`, suppress replay callbacks when the replay starts during initial acquisition. Keep the previous joined live-query window visible while its repair refills after replay. A newer truncate can replace an aborted refill without waiting for its transport to settle.
