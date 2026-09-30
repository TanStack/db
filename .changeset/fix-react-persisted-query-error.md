---
'@tanstack/react-db': patch
---

Surface derived-query load failures to the React ErrorBoundary during network-first initial rendering. Keep the original error isolated by client and clear it when the collection restarts.
