---
"@tanstack/db": patch
---

Fix UI responsiveness issue with rapid user interactions in collections

Fixed a critical issue where rapid user interactions (like clicking multiple checkboxes quickly) would cause the UI to become unresponsive when using collections with slow backend responses. The problem occurred when optimistic updates would back up and the UI would stop reflecting user actions.

**Root Causes:**
- Event filtering logic was blocking ALL events for keys with recent sync operations, including user-initiated actions
- Event batching was queuing user actions instead of immediately updating the UI during high-frequency operations

**Solution:**
- Added `triggeredByUserAction` parameter to `recomputeOptimisticState()` to distinguish user actions from sync operations
- Modified event filtering to allow user-initiated actions to bypass sync status checks
- Enhanced `emitEvents()` with `forceEmit` parameter to skip batching for immediate user action feedback
- Updated all user action code paths to properly identify themselves as user-triggered

This ensures the UI remains responsive during rapid user interactions while maintaining the performance benefits of event batching and duplicate event filtering for sync operations.
