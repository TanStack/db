---
'@tanstack/db': patch
---

Preserve an explicit `gcTime: 0` on live query collections. The live query config builder used `this.config.gcTime || 5000`, so a `gcTime` of `0` (which disables garbage collection) was treated as unset and silently replaced by the 5s default, causing the collection to be garbage collected instead of kept alive. Use `??` so only `undefined` falls back to the default.
