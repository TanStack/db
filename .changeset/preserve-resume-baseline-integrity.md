---
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/db': minor
'@tanstack/electron-db-sqlite-persistence': minor
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
---

Preserve persisted resume integrity with atomic SQLite baseline evidence and stale-writer rejection, expose persistence sync metadata as one versioned capability, and refresh uncertified Electric baselines before publishing resumed data.

This changes the public persistence contracts: custom `PersistenceAdapter` implementations must now implement `loadResumeSnapshot`, and `SyncMetadataApi.persistence` is required with `null` explicitly representing no persistence. Custom sync wrappers must forward `metadata.persistence` unchanged so consumers receive either that sentinel or the complete versioned capability. The Electron bridge now transports the atomic resume snapshot through IPC protocol v2; Electron main and renderer integrations must upgrade together because mixed v1/v2 peers fail closed.
