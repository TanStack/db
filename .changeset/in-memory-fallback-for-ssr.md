---
"@tanstack/db": minor
---

Add in-memory fallback for localStorage collections in SSR environments

Prevents `LocalStorageCollectionError` when localStorage collections are imported on the server by automatically falling back to an in-memory store. This allows isomorphic JavaScript applications to safely import localStorage collection modules without errors during module initialization.

When localStorage is not available (e.g., in server-side rendering environments), the collection automatically uses an in-memory storage implementation. Data will not persist across page reloads or be shared across tabs when using the in-memory fallback, but the collection will function normally otherwise.

Fixes #691
