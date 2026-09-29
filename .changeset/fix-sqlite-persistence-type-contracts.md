---
'@tanstack/db-sqlite-persistence-core': patch
'@tanstack/expo-db-sqlite-persistence': patch
---

Preserve schema input and output inference when persisted collection options are passed to `createCollection`. Accept Expo's native SQLite database type and preserve transaction callback results while validating bind values against Expo's supported domain.
