---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Render completed persisted query data when a client query stream fails during network-first initial rendering. Keep derived-query load failures on the React ErrorBoundary, with errors isolated by client and cleared when the Collection restarts.
