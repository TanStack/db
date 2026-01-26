---
'@tanstack/electric-db-collection': patch
---

Fix unhandled 409 errors during collection cleanup. When a collection is cleaned up while snapshot requests are in-flight, errors are now properly caught and ignored rather than propagating as unhandled promise rejections.
