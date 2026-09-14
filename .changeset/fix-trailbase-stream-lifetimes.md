---
'@tanstack/trailbase-db-collection': patch
---

Fix unhandled rejections and resource leaks when a TrailBase subscription closes, fails, or is cleaned up. Drain buffered events before releasing the reader and prevent a canceled startup from canceling a replacement sync session.
