---
'@tanstack/solid-db': patch
'@tanstack/db': patch
---

Preserve Collection rows and mutation originals while `useLiveQuery` updates, including nested values and explicit undefined fields. Keep unchanged nested elements stable, preserve live nested getters and array notifications, and avoid repeated expansion of shared acyclic values.

Preserve enumerable own source fields, including user symbols and inherited-name shadows, through query selection. Keep accepted nested selection destinations such as `toString` as own output fields.
