---
"@tanstack/db-collections": patch
"@tanstack/react-db": patch
"@tanstack/vue-db": patch
"@tanstack/db": patch
---

A large refactor of the core `Collection` with:

- a change to not use Store internally and emit fine grade changes with `subscribeChanges` and `subscribeKeyChanges` methods.
- changes to the `Collection` api to be more `Map` like for reads, with `get`, `has`, `size`, `entries`, `keys`, and `values`.
- renames `config.getId` to `config.getKey` for consistency with the `Map` like api.
