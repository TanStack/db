---
'@tanstack/solid-db': patch
---

Preserve Collection rows and mutation originals while `useLiveQuery` updates, including nested values and explicit undefined fields. Keep unchanged nested elements stable, preserve live nested getters and array notifications, and avoid repeated expansion of shared acyclic values.
