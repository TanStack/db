---
'@tanstack/offline-transactions': patch
---

Fix date field corruption after app restart. String values matching ISO date format were incorrectly converted to Date objects during deserialization, corrupting user data. Now only explicit Date markers are converted, preserving string values intact.
