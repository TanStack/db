---
'@tanstack/db': patch
---

Clarify queueStrategy error handling behavior in documentation. Changed "guaranteed to persist" to "guaranteed to be attempted" and added explicit documentation about how failed mutations are handled (not retried, queue continues). Added new Retry Behavior section with example code for implementing custom retry logic.
