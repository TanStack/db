---
"@tanstack/db": patch
---

Add warning when calling `.preload()` on collections with `on-demand` syncMode. In on-demand mode, data is only loaded when queries request it, so calling `.preload()` on the collection itself is a no-op. Users should create a live query and call `.preload()` on that instead.
