---
'@tanstack/db-sqlite-persistence-core': minor
'@tanstack/db': minor
'@tanstack/browser-db-sqlite-persistence': patch
'@tanstack/electron-db-sqlite-persistence': minor
'@tanstack/electric-db-collection': patch
'@tanstack/query-db-collection': patch
'@tanstack/node-db-sqlite-persistence': patch
'@tanstack/react-native-db-sqlite-persistence': patch
---

Preserve persisted resume integrity with atomic SQLite baseline evidence and stale-writer rejection, expose persistence sync metadata as one versioned capability, and refresh uncertified Electric baselines before publishing resumed data.

This changes the public persistence contracts: custom `PersistenceAdapter` implementations must now implement `loadResumeSnapshot`, and `SyncMetadataApi.persistence` is required with `null` explicitly representing no persistence. Custom sync wrappers that receive metadata must forward `metadata.persistence` unchanged so consumers receive either that sentinel or the complete versioned capability. A direct sync invocation may still omit the optional metadata object entirely, which consumers treat as no persistence. The Electron bridge now transports the atomic resume snapshot through IPC protocol v2; Electron main and renderer integrations must upgrade together because mixed v1/v2 peers fail closed. Node and React Native persistence instances that wrap one database handle now share transaction admission so concurrent collection startup cannot overlap transactions on that connection.
