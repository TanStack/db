---
'@tanstack/solid-db': patch
'@tanstack/db': patch
---

Preserve Collection rows and mutation originals while Solid `useLiveQuery` updates, including nested values, live getters, callable fields, and explicit undefined fields. Keep unchanged nested elements stable and avoid repeated expansion of shared acyclic values.

Preserve enumerable own source fields through Core query selection, including user symbols and inherited-name shadows. Build nested projections without changing borrowed source data or retaining fields the authored object replaces.
