---
'@tanstack/db-sqlite-persistence-core': patch
---

Preserve accepted sync transactions while they wait behind persisted reads, including transactions that began during an earlier read. Keep newer sync-adapter changes after the persisted baseline and preserve the order of truncate replay.
