---
id: LiveQueryWindowRecompile
title: LiveQueryWindowRecompile
---

```ts
type LiveQueryWindowRecompile = "identity" | "dependencies" | "always";
```

Defined in: [packages/db/src/live-query-window-binding.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L70)

When a query input compiles again.

- `identity`: when its identity dependencies change by structure, as for a
  derived query identity or a `queryKey`.
- `dependencies`: when a dependency changes by reference, as for a
  dependency list.
- `always`: on every update, as for a reactive rerun, which happens only
  when something the query reads changed.
