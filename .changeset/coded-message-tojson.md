---
'@tanstack/db': patch
---

Production error messages no longer run a value's `toJSON()` when they show an array. A plain object inside an array always shows as `"[object]"`, so a row cannot put its contents into a production error message.
