---
"@tanstack/electric-db-collection": patch
"@tanstack/db": patch
---

Fix repeated renders when markReady called when the collection was already ready. This would occur after each long poll on an Electric collection.
