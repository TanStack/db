---
'@tanstack/db': patch
---

Order Temporal values by their calendar or instant semantics in indexed reads. Keep exact equality distinct for ZonedDateTimes in different zones at the same instant. Prevent one Temporal value from changing the comparator used for later values.
