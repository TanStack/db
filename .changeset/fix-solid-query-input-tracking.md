---
'@tanstack/solid-db': patch
---

Prevent native source row reads during query compilation from recreating the Solid framework binding. Keep actual callback and config query parameters reactive.
