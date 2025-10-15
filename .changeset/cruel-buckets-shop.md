---
"@tanstack/db": patch
---

Added comprehensive loading state tracking and configurable sync modes to collections and live queries:

- Added `isLoadingSubset` property and `loadingSubset:change` events to all collections for tracking when data is being loaded
- Added `syncMode` configuration option to collections:
  - `'eager'` (default): Loads all data immediately during initial sync
  - `'on-demand'`: Only loads data as requested via `loadSubset` calls
- Added comprehensive status tracking to collection subscriptions with `status` property (`'ready'` | `'loadingSubset'`) and events (`status:change`, `status:ready`, `status:loadingSubset`, `unsubscribed`)
- Live queries automatically reflect loading state from their source collection subscriptions, with each query maintaining isolated loading state to prevent status "bleed" between independent queries
- Enhanced `setWindow` utility to return `Promise<void>` when loading is triggered, allowing callers to await data loading completion
- Added `subscription` parameter to `loadSubset` handler for advanced sync implementations that need to track subscription lifecycle
