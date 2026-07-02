---
'@tanstack/db': patch
---

Apply committed sync updates immediately while preserving unsettled optimistic mutations in visible collection state. This improves optimistic write reconciliation and stabilizes change events for subscriptions and live queries.
