---
"@tanstack/db": patch
---

Fix proxy to handle frozen objects correctly. Previously, creating a proxy for a frozen object (such as data from state management libraries that freeze their state) would throw a TypeError when attempting to modify properties via the proxy. The proxy now uses an unfrozen internal copy as the Proxy target, allowing modifications to be tracked correctly while preserving the immutability of the original object.
