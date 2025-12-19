---
'@tanstack/db': patch
---

fix: prevent duplicate inserts from reaching D2 pipeline in live queries

Added defensive measures to prevent duplicate INSERT events from reaching the D2 (differential dataflow) pipeline, which could cause items to not disappear when deleted (due to multiplicity going from 2 to 1 instead of 1 to 0).

Changes:

- Added `sentToD2Keys` tracking in `CollectionSubscriber` to filter duplicate inserts at the D2 pipeline entry point
- Fixed `includeInitialState` handling to only pass when `true`, preventing internal lazy-loading subscriptions from incorrectly disabling filtering
- Clear `sentToD2Keys` on truncate to allow re-inserts after collection reset
