---
id: LiveQueryWindowRecompile
title: LiveQueryWindowRecompile
---

```ts
type LiveQueryWindowRecompile = "identity" | "always";
```

Defined in: [packages/db/src/live-query-window-binding.ts:73](https://github.com/TanStack/db/blob/main/packages/db/src/live-query-window-binding.ts#L73)

When a query input compiles again.

- `identity`: when its identity dependencies change by structure, as for a
  derived query identity or a `queryKey`.
- `always`: on every update, as for a reactive rerun, which happens only
  when something the query reads changed.
