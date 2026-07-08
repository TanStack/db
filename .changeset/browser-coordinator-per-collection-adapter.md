---
"@tanstack/browser-db-sqlite-persistence": patch
---

Fix two multi-collection/multi-tab coordinator bugs: register persistence adapters per collection instead of one shared mutable slot, so a collection using a different `schemaVersion` can no longer route another collection's leader-side operations through the wrong adapter and trigger a spurious schema-mismatch wipe (#1589); and strip the per-tab `subscription` object from cross-tab ensureRemoteSubset RPC payloads, which cannot be structured-cloned and caused an endless "Function object could not be cloned" retry flood (#1498).
