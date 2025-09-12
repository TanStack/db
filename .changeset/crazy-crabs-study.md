---
"@tanstack/react-db": patch
---

Adds a server snapshot function to useSyncExternalStore in useLiveQuery to fix "Missing getServerSnapshot" errors during SSR. The server snapshot returns a mock collection with empty data and allows proper hydration. Fixes: https://github.com/TanStack/db/issues/361
