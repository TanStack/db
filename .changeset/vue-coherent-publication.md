---
'@tanstack/vue-db': patch
---

Publish one coherent live-query data snapshot to synchronous Vue watchers. Propagate query errors even when their text matches the disabled-query marker. A saved `data.value` array no longer receives later row-list changes; read `data.value` again for the latest rows.
