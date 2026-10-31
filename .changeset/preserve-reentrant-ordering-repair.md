---
'@tanstack/db': patch
---

Preserve ordering invalidations raised while an ordered repair retires its previous acquisitions. Revalidate the affected source prefix before publishing the repaired window.
