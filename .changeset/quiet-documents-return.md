---
'@tanstack/db': patch
---

Restore nested-row query performance by keeping source payloads opaque during metadata cleanup and resolving includes along compiled paths. Intermediate projections, functional callback inputs, inline results and Effect outputs retain authored fields, while published Collection rows receive genuine computed metadata.

Preserve child identities through outer joins and fan-out, and retain aggregate result types through expression wrappers.
