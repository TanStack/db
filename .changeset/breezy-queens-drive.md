---
"@tanstack/db": patch
---

Fix `stateWhenReady()` and `toArrayWhenReady()` methods to consistently wait for collections to be ready by using `preload()` internally. This ensures the collection starts loading if needed rather than just waiting passively.
