---
'@tanstack/db': minor
---

Add opt-in `publishUnconfirmedOrderedResults` for initial ordered live-query windows from available local rows. Initial-query readiness and preload still wait for provider coverage, and explicit window moves retain atomic publication. React's existing config forwarding accepts the option without adapter changes.
