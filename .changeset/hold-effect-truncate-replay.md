---
'@tanstack/db': patch
---

Keep live query Effect callbacks behind the truncate replay when it starts as a subset acquisition completes. For Effects with `skipInitial`, suppress replay callbacks when the replay starts during initial acquisition and resume ordinary callbacks after the current replay settles. Keep the previous joined live-query window visible while its repair refills after truncate or reload, including after a synchronous adapter reply. A newer truncate can replace an aborted refill without waiting for its transport to settle. Revalidate the ordered prefix when a replay retirement deletes a source row before a new boundary is established.
