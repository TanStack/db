---
'@tanstack/db': patch
---

Allow a `Query` built with Collection descriptors outside a `DbClient` to bind its sources when a client consumes it. A reusable factory descriptor can now serve the same prebuilt query in separate client scopes, including React providers and server preloads.
