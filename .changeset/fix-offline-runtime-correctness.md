---
'@tanstack/offline-transactions': patch
---

Fix offline replay filtering so it preserves concurrently admitted and issued transactions, keep React Native live connectivity events authoritative over stale startup snapshots, and preserve Temporal scalar identity through storage and restart when the runtime provides `globalThis.Temporal`.
