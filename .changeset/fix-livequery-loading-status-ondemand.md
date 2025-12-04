---
"@tanstack/db": patch
---

fix(db): show loading status during initial loadSubset for on-demand sync

Fixed an issue where live queries using on-demand sync mode would immediately show `isLoading: false` and `status: 'ready'` even while the initial data was still being fetched. Now the live query correctly shows `isLoading: true` and `status: 'loading'` until the first `loadSubset` completes.

This ensures that UI components can properly display loading indicators while waiting for the initial data to arrive from on-demand sync sources. Subsequent `loadSubset` calls (e.g., from pagination or windowing) do not affect the ready status.
