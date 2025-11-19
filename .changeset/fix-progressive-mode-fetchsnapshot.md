---
"@tanstack/electric-db-collection": patch
"@tanstack/db-collection-e2e": patch
"@tanstack/db": patch
---

Fix progressive mode to use fetchSnapshot and atomic swap

Progressive mode was broken because `requestSnapshot()` injected snapshots into the stream in causally correct position, which didn't work properly with the `full` mode stream. This release fixes progressive mode by:

**Core Changes:**

- Use `fetchSnapshot()` during initial sync to fetch and apply snapshots immediately in sync transactions
- Buffer all stream messages during initial sync (renamed flag to `isBufferingInitialSync`)
- Perform atomic swap on first `up-to-date`: truncate snapshot data → apply buffered messages → mark ready
- Track txids/snapshots only after atomic swap (enables correct optimistic transaction confirmation)

**Test Infrastructure:**

- Added `ELECTRIC_TEST_HOOKS` symbol for test control (hidden from public API)
- Added `progressiveTestControl.releaseInitialSync()` to E2E test config for explicit transition control
- Created comprehensive progressive mode E2E test suite (8 tests):
  - Explicit snapshot phase and atomic swap validation
  - Txid tracking behavior (Electric-only)
  - Multiple concurrent snapshots with deduplication
  - Incremental updates after swap
  - Predicate handling and resilience tests

**Bug Fixes:**

- Fixed type errors in test files
- All 166 unit tests + 95 E2E tests passing
