---
'@tanstack/db': patch
---

Preserve ordering invalidations raised while an ordered repair retires its previous acquisitions, including an adapter delete of a row in the repaired prefix. Revalidate the affected source prefix before publishing the repaired window.
