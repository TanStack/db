---
'@tanstack/db': patch
---

Preserve ordering invalidations raised while an ordered repair retires its previous acquisitions, including an adapter delete of a row through the repaired prefix's boundary row. Revalidate the affected source prefix before publishing the repaired window.
